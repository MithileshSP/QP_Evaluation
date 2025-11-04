import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json({ limit: "30mb" }));

const port = process.env.PORT || 8100;
const apiKey = process.env.GEMINI_API_KEY || "";

if (!apiKey) {
  console.warn(
    "warning: GEMINI_API_KEY is not set; AI evaluation requests will fail"
  );
}

const DEFAULT_MODEL_CANDIDATES = [
  "models/gemini-1.5-flash-latest",
  "models/gemini-1.5-flash",
  "models/gemini-1.0-pro",
  "models/gemini-pro-vision",
];
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const modelCache = new Map();

app.get("/health", (_, res) => {
  const configuredModel = process.env.GEMINI_MODEL || null;
  res.json({ status: "ok", model: configuredModel });
});

app.post("/evaluate", async (req, res) => {
  try {
    const { prompt, constraints, file } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "prompt is required" });
    }
    if (!file || !file.data || !file.mimeType) {
      return res.status(400).json({ error: "file payload is required" });
    }

    const combinedPrompt = [
      "You are a professional examiner who grades answer scripts strictly but fairly.",
      "Always cite the exact rubric or constraint that led to deductions.",
      "Return your response as JSON with numeric score, numeric maxScore, and reasoning string.",
      prompt,
    ].join("\n\n");

    const userText = [
      "Evaluate the attached submission.",
      constraints ? `Constraints and rubric details:\n${constraints}` : "",
      "Explain any deductions clearly.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const requestBody = {
      system_instruction: {
        parts: [{ text: combinedPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [
            { text: userText },
            {
              inline_data: {
                mime_type: file.mimeType,
                data: file.data,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            score: { type: "number" },
            maxScore: { type: "number" },
            reasoning: { type: "string" },
          },
          required: ["score", "maxScore", "reasoning"],
        },
      },
    };

    const configuredModel = normalizeModelName(process.env.GEMINI_MODEL);
    const configuredVersion = (process.env.GEMINI_API_VERSION || "").trim();
    const apiVersions = configuredVersion
      ? [configuredVersion]
      : ["v1", "v1beta"];

    const modelAttempts = await resolveModelAttempts(
      configuredModel,
      apiVersions,
      requestBody
    );

    if (modelAttempts.length === 0) {
      return res.status(502).json({
        error: "failed to evaluate submission",
        details:
          "Unable to discover a Gemini model that supports generateContent. Set GEMINI_MODEL explicitly in the AI service configuration.",
      });
    }

    let evaluationResponse = null;
    let selectedModel = null;
    let lastNotFoundMessage = null;

    for (const attempt of modelAttempts) {
      try {
        const response = await callGemini(
          attempt.apiVersion,
          attempt.model,
          requestBody
        );
        evaluationResponse = response;
        selectedModel = attempt;
        break;
      } catch (error) {
        const status = error?.response?.status;
        if (status === 404) {
          const message =
            error?.response?.data?.error?.message ||
            error.message ||
            "model not found";
          console.warn(
            `warning: Gemini model "${attempt.model}" unavailable on ${attempt.apiVersion}: ${message}`
          );
          lastNotFoundMessage = message;
          continue;
        }
        throw error;
      }
    }

    if (!evaluationResponse || !selectedModel) {
      return res.status(502).json({
        error: "failed to evaluate submission",
        details:
          lastNotFoundMessage ||
          "No supported Gemini model is available. Specify GEMINI_MODEL or GEMINI_API_VERSION in the AI service configuration.",
        attempted: modelAttempts,
      });
    }

    const candidate = evaluationResponse.data?.candidates?.[0];
    const rawText = candidate?.content?.parts?.[0]?.text || "";

    let parsed;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch (jsonError) {
      console.warn(
        "warning: unable to parse JSON response from Gemini",
        jsonError
      );
    }

    if (!parsed || typeof parsed !== "object") {
      return res.status(502).json({
        error: "unexpected response from Gemini",
        rawResponse: rawText,
      });
    }

    return res.json({
      score: Number(parsed.score ?? 0),
      maxScore: Number(parsed.maxScore ?? 0),
      reasoning: String(parsed.reasoning ?? ""),
      rawResponse: rawText,
      model: selectedModel.model,
      apiVersion: selectedModel.apiVersion,
    });
  } catch (error) {
    console.error(
      "error: gemini evaluation failed",
      error?.response?.data || error.message
    );
    const status = error?.response?.status || 500;
    return res.status(status).json({
      error: "failed to evaluate submission",
      details: error?.response?.data || error.message,
    });
  }
});

async function callGemini(apiVersion, model, body) {
  const modelPath = model.startsWith("models/") ? model : `models/${model}`;
  const url = `https://generativelanguage.googleapis.com/${apiVersion}/${modelPath}:generateContent?key=${apiKey}`;
  return axios.post(url, body, {
    headers: {
      "Content-Type": "application/json",
    },
    timeout: 60000,
  });
}

async function resolveModelAttempts(configuredModel, apiVersions) {
  const attempts = [];

  if (configuredModel) {
    const variants = expandModelVariants(configuredModel);
    variants.forEach((model) => {
      apiVersions.forEach((version) => {
        attempts.push({ apiVersion: version, model });
      });
    });
    return attempts;
  }

  for (const version of apiVersions) {
    const models = await listModels(version);
    if (models.length === 0) {
      continue;
    }
    const eligible = sortModelsByPreference(models).map((model) => ({
      apiVersion: version,
      model: model.name,
    }));
    attempts.push(...eligible);
  }

  if (attempts.length === 0) {
    apiVersions.forEach((version) => {
      DEFAULT_MODEL_CANDIDATES.forEach((model) => {
        attempts.push({ apiVersion: version, model });
      });
    });
  }

  return attempts;
}

async function listModels(apiVersion) {
  const cacheEntry = modelCache.get(apiVersion);
  if (cacheEntry && Date.now() - cacheEntry.fetchedAt < MODEL_CACHE_TTL_MS) {
    return cacheEntry.models;
  }

  try {
    const url = `https://generativelanguage.googleapis.com/${apiVersion}/models?key=${apiKey}`;
    const response = await axios.get(url, {
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });
    const models = response.data?.models || [];
    modelCache.set(apiVersion, { models, fetchedAt: Date.now() });
    return models;
  } catch (error) {
    console.warn(
      `warning: unable to list Gemini models for ${apiVersion}:`,
      error?.response?.data || error.message
    );
    return [];
  }
}

function sortModelsByPreference(models) {
  return (models || [])
    .filter((model) => {
      const methods =
        model.supportedGenerationMethods || model.supported_generation_methods;
      if (!Array.isArray(methods)) {
        return false;
      }
      return methods.some(
        (method) => method.toLowerCase() === "generatecontent"
      );
    })
    .sort((a, b) => scoreModel(b.name) - scoreModel(a.name));
}

function scoreModel(name = "") {
  const value = name.toLowerCase();
  let score = 0;
  if (value.includes("1.5")) score += 5;
  if (value.includes("flash")) score += 4;
  if (value.includes("pro")) score += 3;
  if (value.includes("latest")) score += 2;
  if (value.includes("1.0")) score += 1;
  return score;
}

function normalizeModelName(value) {
  if (!value) {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("models/") ? trimmed : `models/${trimmed}`;
}

app.listen(port, () => {
  console.log(`AI service listening on port ${port}`);
});
