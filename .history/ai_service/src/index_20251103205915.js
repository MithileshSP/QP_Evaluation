import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json({ limit: "30mb" }));

const port = process.env.PORT || 8100;
const apiKey = process.env.GEMINI_API_KEY || "";
const GEMINI_API_URL =
  process.env.GEMINI_API_URL?.trim() ||
  "https://generativelanguage.googleapis.com";
const GEMINI_BASE_URL = GEMINI_API_URL.replace(/\/$/, "");

if (!apiKey) {
  console.warn(
    "warning: GEMINI_API_KEY is not set; AI evaluation requests will fail"
  );
}

app.get("/health", (_, res) => {
  const configuredModel = process.env.GEMINI_MODEL || null;
  res.json({ status: "ok", model: configuredModel });
});

app.post("/evaluate", async (req, res) => {
  try {
    console.log("=== Evaluate Request Received ===");
    const { prompt, constraints, file } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      console.error("error: prompt is missing or invalid");
      return res.status(400).json({ error: "prompt is required" });
    }
    if (!file || !file.data || !file.mimeType) {
      console.error("error: file payload is missing or invalid");
      return res.status(400).json({ error: "file payload is required" });
    }
    if (!apiKey) {
      console.error("error: GEMINI_API_KEY is not configured");
      return res.status(503).json({
        error: "AI service is not configured",
        details: "Set GEMINI_API_KEY in the ai_service environment",
      });
    }

    console.log(`Received file: ${file.name}, mimeType: ${file.mimeType}, data length: ${file.data?.length || 0}`);
    console.log(`Prompt length: ${prompt.length}, Constraints: ${constraints || "none"}`);

    const instructions = [
      "You are a professional examiner who grades answer scripts strictly but fairly.",
      "Always cite the exact rubric or constraint that led to deductions.",
      "Return your response as JSON with numeric score, numeric maxScore, and reasoning string.",
      prompt,
      constraints ? `Constraints and rubric details:\n${constraints}` : "",
      "Explain any deductions clearly and respond only with JSON.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [
            { text: instructions },
            {
              inlineData: {
                mimeType: file.mimeType,
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
      },
    };

    const configuredModel = normalizeModelName(process.env.GEMINI_MODEL);
    if (!configuredModel) {
      console.error("error: GEMINI_MODEL is not configured");
      return res.status(503).json({
        error: "AI service is not configured",
        details: "Set GEMINI_MODEL in the ai_service environment",
      });
    }
    
    console.log(`Using configured model: ${configuredModel}`);
    const configuredVersion = (process.env.GEMINI_API_VERSION || "").trim();
    const apiVersions = configuredVersion
      ? [configuredVersion]
      : ["v1beta", "v1"];

    const modelAttempts = await resolveModelAttempts(
      configuredModel,
      apiVersions
    );

    if (modelAttempts.length === 0) {
      console.error("error: no Gemini models available to attempt");
    } else {
      console.log(
        "model attempts",
        JSON.stringify(
          modelAttempts.map((item) => `${item.apiVersion}:${item.model}`)
        )
      );
    }

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
        console.log(
          "calling Gemini",
          JSON.stringify({
            apiVersion: attempt.apiVersion,
            model: attempt.model,
            hasInlineData: Boolean(
              requestBody?.contents?.[0]?.parts?.find((part) => part.inlineData)
            ),
            hasGenerationConfig: Boolean(requestBody.generationConfig),
          })
        );
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
        if (status === 400) {
          const message =
            error?.response?.data?.error?.message || "bad request";
          console.warn(
            `warning: request rejected by Gemini on ${attempt.apiVersion}: ${message}`
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
  const modelId = model.replace(/^models\//, "");
  const url = `${GEMINI_BASE_URL}/${apiVersion}/models/${modelId}:generateContent`;
  return axios.post(url, body, {
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    params: { key: apiKey },
    timeout: 60000,
  });
}

async function resolveModelAttempts(configuredModel, apiVersions) {
  const attempts = [];
  const pushAttempt = (apiVersion, model) => {
    if (!model) {
      return;
    }
    if (shouldSkipAttempt(apiVersion, model)) {
      return;
    }
    if (
      attempts.some(
        (item) => item.apiVersion === apiVersion && item.model === model
      )
    ) {
      return;
    }
    attempts.push({ apiVersion, model });
  };

  apiVersions.forEach((version) => {
    pushAttempt(version, configuredModel);
  });

  return attempts;
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

function shouldSkipAttempt(apiVersion, modelName) {
  const normalizedVersion = String(apiVersion || "").toLowerCase();
  const normalizedModel = String(modelName || "").toLowerCase();
  if (!normalizedVersion || !normalizedModel) {
    return false;
  }
  if (normalizedModel.includes("1.5") && normalizedVersion === "v1") {
    return true;
  }
  return false;
}

app.listen(port, () => {
  console.log(`AI service listening on port ${port}`);
});
