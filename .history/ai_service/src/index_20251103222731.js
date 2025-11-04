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
const DEFAULT_MODEL = "models/gemini-2.0-flash";
const MAX_TRANSCRIPT_LENGTH = 1500;

if (!apiKey) {
  console.warn(
    "warning: GEMINI_API_KEY is not set; AI evaluation requests will fail"
  );
}

app.get("/health", (_, res) => {
  const configuredModel = getConfiguredModelOverride();
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
      "Include a transcript field summarizing the key questions and answers extracted from the submission as plain text (maximum 1200 characters).",
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

    const configuredModel = getConfiguredModelOverride();
    const targetModel = configuredModel || DEFAULT_MODEL;
    if (configuredModel) {
      console.log(`Using configured model override: ${targetModel}`);
    } else {
      console.log(`Using default Gemini model: ${targetModel}`);
    }
    const apiVersions = getApiVersionsToTry();
    const attemptedModels = [];
    let evaluationResponse = null;
    let selectedModel = targetModel;
    let selectedApiVersion = null;
    let lastNotFoundMessage = null;

    const primaryAttempt = await attemptModelRequest(
      targetModel,
      apiVersions,
      requestBody
    );
    attemptedModels.push(normalizeModelName(targetModel));

    if (primaryAttempt.response && primaryAttempt.apiVersion) {
      evaluationResponse = primaryAttempt.response;
      selectedApiVersion = primaryAttempt.apiVersion;
    } else if (
      configuredModel &&
      normalizeModelName(targetModel) !== normalizeModelName(DEFAULT_MODEL)
    ) {
      console.warn(
        `warning: configured model "${targetModel}" failed; falling back to default model ${DEFAULT_MODEL}`
      );
      const fallbackAttempt = await attemptModelRequest(
        DEFAULT_MODEL,
        apiVersions,
        requestBody
      );
      attemptedModels.push(normalizeModelName(DEFAULT_MODEL));
      if (fallbackAttempt.response && fallbackAttempt.apiVersion) {
        evaluationResponse = fallbackAttempt.response;
        selectedApiVersion = fallbackAttempt.apiVersion;
        selectedModel = normalizeModelName(DEFAULT_MODEL);
        lastNotFoundMessage = fallbackAttempt.lastMessage;
      } else {
        lastNotFoundMessage =
          fallbackAttempt.lastMessage || primaryAttempt.lastMessage;
      }
    } else {
      lastNotFoundMessage = primaryAttempt.lastMessage;
    }

    if (!evaluationResponse || !selectedApiVersion) {
      return res.status(502).json({
        error: "failed to evaluate submission",
        details:
          lastNotFoundMessage ||
          "No supported Gemini model is available for this API key. Check your Gemini project access or set GEMINI_MODEL and GEMINI_API_VERSION explicitly.",
        attemptedVersions: apiVersions,
        attemptedModels,
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
      parsed = rawText ? parseJsonCandidate(rawText) : null;
    } catch (jsonError) {
      console.warn(
        "warning: unable to parse JSON response from Gemini",
        jsonError
      );
      console.log(`Full raw response: ${rawText}`);
    }

    if (!rawText || !parsed || typeof parsed !== "object") {
      console.error("error: unexpected response format from Gemini");
      const promptFeedback = summarizePromptFeedback(evaluationResponse.data);
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

    const transcript = coerceTranscript(parsed.transcript);

    return res.json({
      score: Number(parsed.score ?? 0),
      maxScore: Number(parsed.maxScore ?? 0),
      reasoning: String(parsed.reasoning ?? ""),
      rawResponse: rawText,
      model: selectedModel,
      apiVersion: selectedApiVersion,
      transcript,
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

async function attemptModelRequest(model, apiVersions, requestBody) {
  const normalizedModel = normalizeModelName(model);
  const hasInlineData = Boolean(
    requestBody?.contents?.[0]?.parts?.find((part) => part.inlineData)
  );
  const hasGenerationConfig = Boolean(requestBody?.generationConfig);
  let lastMessage = null;

  for (const apiVersion of apiVersions) {
    try {
      console.log(
        "calling Gemini",
        JSON.stringify({
          apiVersion,
          model: normalizedModel,
          hasInlineData,
          hasGenerationConfig,
        })
      );
      const response = await callGemini(
        apiVersion,
        normalizedModel,
        requestBody
      );
      return { response, apiVersion, lastMessage: null };
    } catch (error) {
      const status = error?.response?.status;
      if (status === 404 || status === 400) {
        const message =
          error?.response?.data?.error?.message ||
          error.message ||
          (status === 404 ? "model not found" : "bad request");
        if (status === 404) {
          console.warn(
            `warning: Gemini model "${normalizedModel}" unavailable on ${apiVersion}: ${message}`
          );
        } else {
          console.warn(
            `warning: request rejected by Gemini on ${apiVersion}: ${message}`
          );
        }
        lastMessage = message;
        continue;
      }
      throw error;
    }
  }

  return { response: null, apiVersion: null, lastMessage };
}

function getConfiguredModelOverride() {
  const raw = process.env.GEMINI_MODEL;
  if (!raw) {
    return "";
  }
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed.toLowerCase() === "auto") {
    return "";
  }
  return normalizeModelName(trimmed);
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

function getApiVersionsToTry() {
  const configured = (process.env.GEMINI_API_VERSION || "").trim();
  if (configured) {
    return [configured];
  }
  return ["v1", "v1beta"];
}

function parseJsonCandidate(rawText) {
  const sanitized = stripMarkdownFence(rawText);
  return JSON.parse(sanitized);
}

function stripMarkdownFence(rawText) {
  let trimmed = String(rawText || "").trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }
  trimmed = trimmed.replace(/^```[-\w]*\s*/i, "");
  trimmed = trimmed.replace(/\s*```$/, "");
  return trimmed.trim();
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
