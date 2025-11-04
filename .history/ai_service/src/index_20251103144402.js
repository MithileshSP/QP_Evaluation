import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json({ limit: "30mb" }));

const port = process.env.PORT || 8100;
const apiKey = process.env.GEMINI_API_KEY || "";

if (!apiKey) {
  console.warn("warning: GEMINI_API_KEY is not set; AI evaluation requests will fail");
}

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash-latest";

app.get("/health", (_, res) => {
  res.json({ status: "ok", model: GEMINI_MODEL });
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

    const body = {
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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    const response = await axios.post(url, body, {
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 60000,
    });

    const candidate = response.data?.candidates?.[0];
    const rawText = candidate?.content?.parts?.[0]?.text || "";

    let parsed;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch (jsonError) {
      console.warn("warning: unable to parse JSON response from Gemini", jsonError);
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
    });
  } catch (error) {
    console.error("error: gemini evaluation failed", error?.response?.data || error.message);
    const status = error?.response?.status || 500;
    return res.status(status).json({
      error: "failed to evaluate submission",
      details: error?.response?.data || error.message,
    });
  }
});

app.listen(port, () => {
  console.log(`AI service listening on port ${port}`);
});
