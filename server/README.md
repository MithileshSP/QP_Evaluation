# CLG QP Server

Go backend that exposes REST APIs for prompt management and submission evaluation.

## Setup

```bash
cp .env.example .env
# update MongoDB URI and Gemini AI service URL

# install dependencies
cd server
go mod tidy

# run the server
PORT=8000 go run ./...
```

The server automatically creates MongoDB collections and indexes when requests are processed. Files uploaded by users are persisted in the `uploads` directory (configurable via `UPLOADS_DIR`).
