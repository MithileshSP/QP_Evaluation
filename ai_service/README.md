# AI Service

Node.js microservice that wraps the Gemini API to evaluate handwritten answer sheets.

## Setup

```bash
cp .env.example .env
# set GEMINI_API_KEY (keep it private!) and optional PORT/GEMINI_MODEL

cd ai_service
npm install
npm run dev
```

The service listens on port `8100` by default and exposes:

- `GET /health` — lightweight readiness check.
- `POST /evaluate` — accepts `{ prompt, constraints, file }` payloads from the Go backend.
