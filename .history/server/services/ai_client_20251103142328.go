package services

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
    "os"
    "time"
)

// EvaluationRequest is sent to the AI microservice.
type EvaluationRequest struct {
    Prompt      string          `json:"prompt"`
    Constraints string          `json:"constraints"`
    File        EvaluationFile  `json:"file"`
}

// EvaluationFile wraps a file payload for the AI service.
type EvaluationFile struct {
    Name     string `json:"name"`
    MimeType string `json:"mimeType"`
    Data     string `json:"data"`
}

// EvaluationResponse represents the AI grading output.
type EvaluationResponse struct {
    Score        float64 `json:"score"`
    MaxScore     float64 `json:"maxScore"`
    Reasoning    string  `json:"reasoning"`
    RawResponse  string  `json:"rawResponse"`
}

// EvaluateSubmission sends the submission payload to the AI service and returns the evaluation result.
func EvaluateSubmission(req EvaluationRequest) (*EvaluationResponse, error) {
    baseURL := os.Getenv("AI_SERVICE_BASE_URL")
    if baseURL == "" {
        baseURL = "http://localhost:8100"
    }

    bodyBytes, err := json.Marshal(req)
    if err != nil {
        return nil, fmt.Errorf("marshal evaluation request: %w", err)
    }

    httpClient := &http.Client{Timeout: 60 * time.Second}
    endpoint := fmt.Sprintf("%s/evaluate", baseURL)
    httpReq, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewBuffer(bodyBytes))
    if err != nil {
        return nil, fmt.Errorf("build evaluation request: %w", err)
    }
    httpReq.Header.Set("Content-Type", "application/json")

    resp, err := httpClient.Do(httpReq)
    if err != nil {
        return nil, fmt.Errorf("call evaluation service: %w", err)
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        return nil, fmt.Errorf("evaluation service returned status %d", resp.StatusCode)
    }

    var aiResp EvaluationResponse
    if err := json.NewDecoder(resp.Body).Decode(&aiResp); err != nil {
        return nil, fmt.Errorf("decode evaluation response: %w", err)
    }
    return &aiResp, nil
}
