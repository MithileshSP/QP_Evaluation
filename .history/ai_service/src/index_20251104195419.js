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
const MAX_TRANSCRIPT_LENGTH = 1200;
const MAX_ALIGNMENT_WARNING_LENGTH = 400;
const MAX_BREAKDOWN_REASON_LENGTH = 600;
const MAX_CONCURRENT_EVALUATIONS = Number(
  process.env.MAX_CONCURRENT_EVALUATIONS || 1
);
const MIN_EVALUATION_INTERVAL_MS = Number(
  process.env.MIN_EVALUATION_INTERVAL_MS || 2000
);
const DEFAULT_RETRY_AFTER_SECONDS = Number(
  process.env.GEMINI_RETRY_AFTER_SECONDS || 60
);

const FILE_ROLES = {
  QUESTION_PAPER: "question_paper",
  ANSWER_KEY: "answer_key",
  SUBMISSION: "student_submission",
};

let activeEvaluations = 0;
let lastEvaluationCompletedAt = 0;

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
    const { prompt, constraints, files, file } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      console.error("error: prompt is missing or invalid");
      return res.status(400).json({ error: "prompt is required" });
    }

    let attachments = Array.isArray(files) ? files : [];
    if (attachments.length === 0 && file) {
      // backward compatibility with legacy payloads
      attachments = [
        {
          ...file,
          role: file.role || FILE_ROLES.SUBMISSION,
        },
      ];
    }

    const findByRole = (role) =>
      attachments.find(
        (item) => (item.role || "").toLowerCase() === role
      );

    const questionPaper = findByRole(FILE_ROLES.QUESTION_PAPER);
    const answerKey = findByRole(FILE_ROLES.ANSWER_KEY);
    let submission = findByRole(FILE_ROLES.SUBMISSION);
    if (!submission && attachments.length === 1) {
      submission = attachments[0];
    }

    const missingRoles = [];
    if (!questionPaper || !questionPaper.data || !questionPaper.mimeType) {
      missingRoles.push(FILE_ROLES.QUESTION_PAPER);
    }
    if (!answerKey || !answerKey.data || !answerKey.mimeType) {
      missingRoles.push(FILE_ROLES.ANSWER_KEY);
    }
    if (!submission || !submission.data || !submission.mimeType) {
      missingRoles.push(FILE_ROLES.SUBMISSION);
    }

    if (missingRoles.length > 0) {
      console.error(
        `error: missing or invalid attachments for roles: ${missingRoles.join(", ")}`
      );
      return res.status(400).json({
        error: "file payload is required",
        details: `Missing attachments for: ${missingRoles.join(", ")}`,
      });
    }
    if (!apiKey) {
      console.error("error: GEMINI_API_KEY is not configured");
      return res.status(503).json({
        error: "AI service is not configured",
        details: "Set GEMINI_API_KEY in the ai_service environment",
      });
    }

    console.log(
      `Attachments => question_paper: ${questionPaper.name}, answer_key: ${answerKey.name}, submission: ${submission.name}`
    );
    console.log(
      `Prompt length: ${prompt.length}, Constraints: ${constraints || "none"}`
    );

    const instructions = [
      "You are a professional examiner who grades answer scripts strictly but fairly.",
      "Always cite the exact rubric or constraint that led to deductions.",
      "Use the attachments as follows:",
      `- question_paper (${questionPaper.mimeType}): original exam questions.`,
      `- answer_key (${answerKey.mimeType}): authoritative solutions.`,
      `- student_submission (${submission.mimeType}): answers to grade.",
      "Return JSON with: score, maxScore, reasoning, transcript (<=1200 chars), alignmentWarning, breakdown (array of {questionNumber, score, maxScore, reason}).",
      "Reason should explain the awarded marks and any deduction cause per question. Omit questions absent from submission.",
      "If the provided constraints or prompt do not match the uploaded answers, include an alignmentWarning field explaining the mismatch; otherwise return an empty string for alignmentWarning.",
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
            { text: "Question paper (role=question_paper)" },
            {
              inlineData: {
                mimeType: questionPaper.mimeType,
                data: questionPaper.data,
              },
            },
            { text: "Answer key (role=answer_key)" },
            {
              inlineData: {
                mimeType: answerKey.mimeType,
                data: answerKey.data,
              },
            },
            { text: "Student submission (role=student_submission)" },
            {
              inlineData: {
                mimeType: submission.mimeType,
                data: submission.data,
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
    const apiVersions = getApiVersionsToTry();
    const attemptedModels = [];
    let evaluationResponse = null;
    let selectedModel = normalizeModelName(targetModel);
    let selectedApiVersion = null;
    let lastNotFoundMessage = null;
    let lastStatusCode = null;

    const releaseSlot = await takeEvaluationSlot();
    try {
      if (configuredModel) {
        console.log(`Using configured model override: ${targetModel}`);
      } else {
        console.log(`Using default Gemini model: ${targetModel}`);
      }

      const primaryAttempt = await attemptModelRequest(
        targetModel,
        apiVersions,
        requestBody
      );
      attemptedModels.push(normalizeModelName(targetModel));
      lastStatusCode = primaryAttempt.status ?? null;

      if (primaryAttempt.status === 429) {
        const message =
          primaryAttempt.lastMessage ||
          "Gemini quota exhausted. Please retry after a short pause.";
        res.set("Retry-After", String(DEFAULT_RETRY_AFTER_SECONDS));
        return res.status(429).json({
          error: "ai-service-quota-exceeded",
          details: message,
          retryAfterSeconds: DEFAULT_RETRY_AFTER_SECONDS,
          attemptedVersions: apiVersions,
          attemptedModels,
        });
      }

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

        if (fallbackAttempt.status === 429) {
          const message =
            fallbackAttempt.lastMessage ||
            primaryAttempt.lastMessage ||
            "Gemini quota exhausted. Please retry after a short pause.";
          res.set("Retry-After", String(DEFAULT_RETRY_AFTER_SECONDS));
          return res.status(429).json({
            error: "ai-service-quota-exceeded",
            details: message,
            retryAfterSeconds: DEFAULT_RETRY_AFTER_SECONDS,
            attemptedVersions: apiVersions,
            attemptedModels,
          });
        }

        if (fallbackAttempt.response && fallbackAttempt.apiVersion) {
          evaluationResponse = fallbackAttempt.response;
          selectedApiVersion = fallbackAttempt.apiVersion;
          selectedModel = normalizeModelName(DEFAULT_MODEL);
          lastStatusCode = fallbackAttempt.status ?? 200;
          lastNotFoundMessage = fallbackAttempt.lastMessage;
        } else {
          lastNotFoundMessage =
            fallbackAttempt.lastMessage || primaryAttempt.lastMessage;
          lastStatusCode = fallbackAttempt.status ?? lastStatusCode;
        }
      } else {
        lastNotFoundMessage = primaryAttempt.lastMessage;
      }

      if (!evaluationResponse || !selectedApiVersion) {
        const failureStatus =
          lastStatusCode === 403 || lastStatusCode === 401
            ? lastStatusCode
            : 502;
        return res.status(failureStatus || 502).json({
          error: "failed to evaluate submission",
          details:
            lastNotFoundMessage ||
            "No supported Gemini model is available for this API key. Check your Gemini project access or set GEMINI_MODEL and GEMINI_API_VERSION explicitly.",
          attemptedVersions: apiVersions,
          attemptedModels,
          statusCode: lastStatusCode,
        });
      }
    } finally {
      releaseSlot();
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
    const alignmentWarning = coerceAlignmentWarning(
      parsed.alignmentWarning || parsed.alignment_warning
    );

    return res.json({
      score: Number(parsed.score ?? 0),
      maxScore: Number(parsed.maxScore ?? 0),
      reasoning: String(parsed.reasoning ?? ""),
      rawResponse: rawText,
      model: selectedModel,
      apiVersion: selectedApiVersion,
      transcript,
      alignmentWarning,
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
  let lastStatus = null;

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
      return { response, apiVersion, lastMessage: null, status: 200 };
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
        lastStatus = status;
        continue;
      }
      if (status === 429 || status === 403) {
        const message =
          error?.response?.data?.error?.message ||
          error.message ||
          (status === 429
            ? "rate limit exceeded"
            : "access to this model is not permitted");
        console.warn(
          `warning: Gemini request blocked on ${apiVersion} (${status}): ${message}`
        );
        return {
          response: null,
          apiVersion: null,
          lastMessage: message,
          status,
        };
      }
      throw error;
    }
  }

  return { response: null, apiVersion: null, lastMessage, status: lastStatus };
}

async function takeEvaluationSlot() {
  const maxConcurrent = Math.max(1, MAX_CONCURRENT_EVALUATIONS);
  while (activeEvaluations >= maxConcurrent) {
    await sleep(100);
  }

  const now = Date.now();
  const waitMs = Math.max(
    0,
    lastEvaluationCompletedAt + MIN_EVALUATION_INTERVAL_MS - now
  );
  if (waitMs > 0) {
    console.log(
      `Throttling evaluation request for ${waitMs}ms to respect rate limits`
    );
    await sleep(waitMs);
  }

  activeEvaluations += 1;
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    activeEvaluations = Math.max(0, activeEvaluations - 1);
    lastEvaluationCompletedAt = Date.now();
  };
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function coerceTranscript(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length > MAX_TRANSCRIPT_LENGTH) {
    return `${trimmed.slice(0, MAX_TRANSCRIPT_LENGTH)}…`;
  }
  return trimmed;
}

function coerceAlignmentWarning(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length > MAX_ALIGNMENT_WARNING_LENGTH) {
    return `${trimmed.slice(0, MAX_ALIGNMENT_WARNING_LENGTH)}…`;
  }
  return trimmed;
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
