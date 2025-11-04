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
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const modelCache = new Map();
const SAFE_FALLBACK_MODELS = [
  "models/gemini-flash-latest",
  "models/gemini-2.0-flash",
  "models/gemini-2.5-flash",
  "models/gemini-2.0-flash-lite",
];

if (!apiKey) {
  console.warn(
    "warning: GEMINI_API_KEY is not set; AI evaluation requests will fail"
  );
}

app.get("/health", (_, res) => {
  const configuredModel = normalizeModelName(process.env.GEMINI_MODEL);
  res.json({
    status: apiKey ? "ok" : "missing-api-key",
    model: configuredModel || "auto",
  });
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

    console.log(
      `Received file: ${file.name}, mimeType: ${file.mimeType}, data length: ${
        file.data?.length || 0
      }`
    );
    console.log(
      `Prompt length: ${prompt.length}, Constraints: ${constraints || "none"}`
    );

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
    if (configuredModel) {
      console.log(`Using configured model override: ${configuredModel}`);
    } else {
      console.log("No GEMINI_MODEL configured; attempting auto-discovery");
    }
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
          "Unable to discover a Gemini model that supports generateContent. Verify your API key has access or set GEMINI_MODEL to a specific model ID.",
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
          "No supported Gemini model is available for this API key. Check your Gemini project access or set GEMINI_MODEL and GEMINI_API_VERSION explicitly.",
        attempted: modelAttempts,
      });
    }

    const selection = selectCandidateWithText(
      evaluationResponse.data?.candidates
    );
    const candidate = selection?.candidate || null;
    const rawText = selection?.text || "";
    const finishReason = getFinishReason(candidate);

    console.log(
      `Gemini response received, raw text length: ${rawText.length}, finishReason: ${finishReason}`
    );
    if (rawText) {
      console.log(`Raw response: ${rawText.substring(0, 500)}`);
    }

    let parsed;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch (jsonError) {
      console.warn(
        "warning: unable to parse JSON response from Gemini",
        jsonError
      );
      console.log(`Full raw response: ${rawText}`);
    }

    if (!rawText || !parsed || typeof parsed !== "object") {
      console.error("error: unexpected response format from Gemini");
      const promptFeedback = summarizePromptFeedback(
        evaluationResponse.data
      );
      return res.status(502).json({
        error: "unexpected response from Gemini",
        finishReason,
        promptFeedback,
        candidate: summarizeCandidate(candidate),
      });
    }

    console.log(
      `Successfully parsed Gemini response: score=${parsed.score}, maxScore=${parsed.maxScore}`
    );

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
  const seen = new Set();
  const pushAttempt = (apiVersion, model) => {
    const normalizedModel = normalizeModelName(model);
    if (!normalizedModel) {
      return;
    }
    if (shouldSkipAttempt(apiVersion, normalizedModel)) {
      return;
    }
    const key = `${apiVersion}:${normalizedModel}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    attempts.push({ apiVersion, model: normalizedModel });
  };

  apiVersions.forEach((version) => {
    if (configuredModel) {
      pushAttempt(version, configuredModel);
    }
  });

  const discovered = await discoverModels(apiVersions);
  discovered.forEach((attempt) =>
    pushAttempt(attempt.apiVersion, attempt.model)
  );

  if (!attempts.length) {
    apiVersions.forEach((version) => {
      SAFE_FALLBACK_MODELS.forEach((model) => pushAttempt(version, model));
    });
  }

  return attempts;
}

async function discoverModels(apiVersions) {
  const discovered = [];
  for (const version of apiVersions) {
    const models = await listModels(version);
    if (!models.length) {
      continue;
    }
    const preferred = sortModelsByPreference(models);
    preferred.forEach((model) => {
      const name = normalizeModelName(model.name || model.id || model);
      if (name) {
        discovered.push({ apiVersion: version, model: name });
      }
    });
  }
  return discovered;
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

async function listModels(apiVersion) {
  const cacheEntry = modelCache.get(apiVersion);
  if (cacheEntry && Date.now() - cacheEntry.fetchedAt < MODEL_CACHE_TTL_MS) {
    return cacheEntry.models;
  }

  try {
    const url = `${GEMINI_BASE_URL}/${apiVersion}/models`;
    const response = await axios.get(url, {
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      params: { key: apiKey, pageSize: 100 },
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
    .filter(supportsGenerateContent)
    .map((model) => ({
      model,
      score:
        scoreModel(model.name) +
        (supportsVisionInput(model) ? 10 : 0) +
        (supportsPdfInput(model) ? 3 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.model);
}

function scoreModel(name = "") {
  const value = String(name).toLowerCase();
  let score = 0;
  if (value.includes("1.5")) score += 5;
  if (value.includes("flash")) score += 4;
  if (value.includes("pro")) score += 3;
  if (value.includes("vision")) score += 6;
  if (value.includes("latest")) score += 1;
  return score;
}

function supportsGenerateContent(model = {}) {
  const methods =
    model.supportedGenerationMethods || model.supported_generation_methods;
  if (!Array.isArray(methods)) {
    return false;
  }
  return methods.some(
    (method) => String(method).toLowerCase() === "generatecontent"
  );
}

function supportsVisionInput(model = {}) {
  const modalities =
    model.supportedInputModalities ||
    model.inputModalities ||
    model.supported_input_modalities ||
    [];
  return modalities.some((item) =>
    String(item).toUpperCase().includes("IMAGE")
  );
}

function supportsPdfInput(model = {}) {
  const modalities =
    model.supportedInputModalities ||
    model.inputModalities ||
    model.supported_input_modalities ||
    [];
  return modalities.some((item) =>
    ["FILE", "DOCUMENT"].some((keyword) =>
      String(item).toUpperCase().includes(keyword)
    )
  );
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

function selectCandidateWithText(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  for (const candidate of candidates) {
    const text = extractTextFromParts(candidate?.content?.parts);
    if (text) {
      return { candidate, text };
    }
  }

  const fallback = candidates[0];
  return {
    candidate: fallback,
    text: extractTextFromParts(fallback?.content?.parts),
  };
}

function extractTextFromParts(parts) {
  if (!Array.isArray(parts)) {
    return "";
  }
  for (const part of parts) {
    const text = typeof part?.text === "string" ? part.text.trim() : "";
    if (text) {
      return text;
    }
  }
  return "";
}

function getFinishReason(candidate) {
  if (!candidate) {
    return null;
  }
  return candidate.finishReason || candidate.finish_reason || null;
}

function summarizeCandidate(candidate) {
  if (!candidate) {
    return null;
  }
  return {
    finishReason: getFinishReason(candidate),
    safetyRatings: candidate.safetyRatings || candidate.safety_ratings || [],
    citationMetadata: candidate.citationMetadata
      ? {
          citations:
            candidate.citationMetadata.citations?.length ||
            candidate.citation_metadata?.citations?.length ||
            0,
        }
      : undefined,
  };
}

function summarizePromptFeedback(payload) {
  if (!payload) {
    return null;
  }
  const feedback = payload.promptFeedback || payload.prompt_feedback;
  if (!feedback) {
    return null;
  }
  return {
    blockReason: feedback.blockReason || feedback.block_reason || null,
    safetyRatings: feedback.safetyRatings || feedback.safety_ratings || [],
    safeguards: feedback.safeguards,
  };
}

app.listen(port, () => {
  console.log(`AI service listening on port ${port}`);
});
