package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// File roles used by the AI evaluation payload.
const (
	FileRoleQuestionPaper = "question_paper"
	FileRoleAnswerKey     = "answer_key"
	FileRoleSubmission    = "student_submission"
)

// EvaluationRequest is sent to the AI microservice.
type EvaluationRequest struct {
	Prompt      string           `json:"prompt"`
	Constraints string           `json:"constraints"`
	Files       []EvaluationFile `json:"files"`
}

// EvaluationFile wraps a file payload for the AI service.
type EvaluationFile struct {
	Role     string `json:"role,omitempty"`
	Name     string `json:"name"`
	MimeType string `json:"mimeType"`
	Data     string `json:"data"`
}

// EvaluationResponse represents the AI grading output.
type EvaluationResponse struct {
	Score            float64             `json:"score"`
	MaxScore         float64             `json:"maxScore"`
	Reasoning        string              `json:"reasoning"`
	RawResponse      string              `json:"rawResponse"`
	Transcript       string              `json:"transcript"`
	AlignmentWarning string              `json:"alignmentWarning"`
	Breakdown        []QuestionBreakdown `json:"breakdown"`
}

// QuestionPaperAnalysisRequest is sent to the AI microservice to derive metadata from the exam.
type QuestionPaperAnalysisRequest struct {
	QuestionPaper EvaluationFile `json:"questionPaper"`
}

// QuestionPaperAnalysis holds the structured output returned by the AI microservice.
type QuestionPaperAnalysis struct {
	Title      string                    `json:"title"`
	Subject    string                    `json:"subject"`
	CohortType string                    `json:"cohortType"`
	Grade      string                    `json:"grade"`
	MaxScore   float64                   `json:"maxScore"`
	Questions  []QuestionPaperDescriptor `json:"questions"`
	Notes      string                    `json:"notes"`
}

// QuestionPaperDescriptor describes a single answer key entry.
type QuestionPaperDescriptor struct {
	QuestionNumber string  `json:"questionNumber"`
	Answer         string  `json:"answer"`
	MaxScore       float64 `json:"maxScore"`
}

// QuestionBreakdown returns per-question marks so the UI can explain deductions.
type QuestionBreakdown struct {
	QuestionNumber string  `json:"questionNumber"`
	Score          float64 `json:"score"`
	MaxScore       float64 `json:"maxScore"`
	Reason         string  `json:"reason"`
}

// EvaluationError captures non-200 responses from the AI microservice.
type EvaluationError struct {
	StatusCode int
	Body       string
}

// Error returns a human-readable description of the evaluation error.
func (e *EvaluationError) Error() string {
	message := strings.TrimSpace(e.Body)
	if message == "" {
		message = http.StatusText(e.StatusCode)
	}
	return fmt.Sprintf("evaluation service returned status %d: %s", e.StatusCode, message)
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

	// Increase timeout to 3 minutes for AI processing
	httpClient := &http.Client{Timeout: 180 * time.Second}
	endpoint := fmt.Sprintf("%s/evaluate", baseURL)
	httpReq, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewBuffer(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("build evaluation request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(httpReq)
	if err != nil {
		// Check if it's a timeout error
		if os.IsTimeout(err) || strings.Contains(err.Error(), "timeout") || strings.Contains(err.Error(), "deadline exceeded") {
			return nil, fmt.Errorf("AI service timeout - the request took too long to process. Try with smaller files or fewer submissions: %w", err)
		}
		return nil, fmt.Errorf("call evaluation service: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			return nil, &EvaluationError{StatusCode: resp.StatusCode, Body: ""}
		}
		return nil, &EvaluationError{StatusCode: resp.StatusCode, Body: string(body)}
	}

	var aiResp EvaluationResponse
	if err := json.NewDecoder(resp.Body).Decode(&aiResp); err != nil {
		return nil, fmt.Errorf("decode evaluation response: %w", err)
	}
	return &aiResp, nil
}

// AnalysisError captures non-200 responses from the AI analysis endpoint.
type AnalysisError struct {
	StatusCode int
	Body       string
}

// Error returns a human-readable description of the analysis error.
func (e *AnalysisError) Error() string {
	message := strings.TrimSpace(e.Body)
	if message == "" {
		message = http.StatusText(e.StatusCode)
	}
	return fmt.Sprintf("question paper analysis service returned status %d: %s", e.StatusCode, message)
}

// AnalyzeQuestionPaper asks the AI service to infer metadata and an answer key from the question paper.
func AnalyzeQuestionPaper(req QuestionPaperAnalysisRequest) (*QuestionPaperAnalysis, error) {
	baseURL := os.Getenv("AI_SERVICE_BASE_URL")
	if baseURL == "" {
		baseURL = "http://localhost:8100"
	}

	bodyBytes, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal analysis request: %w", err)
	}

	httpClient := &http.Client{Timeout: 180 * time.Second}
	endpoint := fmt.Sprintf("%s/assessments/analyze", baseURL)
	httpReq, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewBuffer(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("build analysis request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("call analysis service: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			return nil, &AnalysisError{StatusCode: resp.StatusCode, Body: ""}
		}
		return nil, &AnalysisError{StatusCode: resp.StatusCode, Body: string(body)}
	}

	var analysis QuestionPaperAnalysis
	if err := json.NewDecoder(resp.Body).Decode(&analysis); err != nil {
		return nil, fmt.Errorf("decode analysis response: %w", err)
	}

	return &analysis, nil
}
