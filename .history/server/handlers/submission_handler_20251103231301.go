package handlers

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/example/clg-qps/server/models"
	"github.com/example/clg-qps/server/services"
	"github.com/example/clg-qps/server/utils"
)

// SubmissionHandler manages learner uploads and retrieval.
type SubmissionHandler struct {
	submissions *mongo.Collection
	prompts     *mongo.Collection
}

// NewSubmissionHandler constructs a SubmissionHandler.
func NewSubmissionHandler(db *mongo.Database) *SubmissionHandler {
	submissionCollection := db.Collection("submissions")
	ensureSubmissionIndexes(submissionCollection)
	return &SubmissionHandler{
		submissions: submissionCollection,
		prompts:     db.Collection("prompts"),
	}
}

func ensureSubmissionIndexes(col *mongo.Collection) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	indexModel := mongo.IndexModel{
		Keys:    bson.D{{Key: "created_at", Value: -1}},
		Options: options.Index().SetName("created_at_desc"),
	}
	if _, err := col.Indexes().CreateOne(ctx, indexModel); err != nil {
		log.Printf("warning: unable to ensure submissions index: %v", err)
	}
}

// UploadSubmission handles file uploads and triggers AI evaluation.
func (h *SubmissionHandler) UploadSubmission(c *gin.Context) {
	log.Printf("UploadSubmission: received request")

	formFile, err := c.FormFile("file")
	if err != nil {
		log.Printf("error: no file in request: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}

	log.Printf("UploadSubmission: received file %s, size=%d bytes, content-type=%s",
		formFile.Filename, formFile.Size, formFile.Header.Get("Content-Type"))

	if formFile.Size == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is empty"})
		return
	}

	// Derive additional metadata.
	title := c.PostForm("title")
	if title == "" {
		title = strings.TrimSuffix(formFile.Filename, filepath.Ext(formFile.Filename))
	}

	subject := strings.TrimSpace(c.PostForm("subject"))
	if subject != "" {
		log.Printf("UploadSubmission: subject provided -> %s", subject)
	}

	maxScore := 10.0
	if raw := c.PostForm("maxScore"); raw != "" {
		if parsed, parseErr := strconv.ParseFloat(raw, 64); parseErr == nil && parsed > 0 {
			maxScore = parsed
		}
	}

	uploadsDir := os.Getenv("UPLOADS_DIR")
	if uploadsDir == "" {
		uploadsDir = "uploads"
	}

	if err := os.MkdirAll(uploadsDir, 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to prepare upload directory"})
		return
	}

	safeFilename := fmt.Sprintf("%d_%s", time.Now().UnixNano(), sanitizeFileName(formFile.Filename))
	storedPath := filepath.Join(uploadsDir, safeFilename)

	log.Printf("UploadSubmission: saving file to %s", storedPath)

	if err := c.SaveUploadedFile(formFile, storedPath); err != nil {
		log.Printf("error: unable to save file: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to save file"})
		return
	}

	log.Printf("UploadSubmission: file saved successfully")

	fileBytes, err := os.ReadFile(storedPath)
	if err != nil {
		log.Printf("error: unable to read saved file: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to read saved file"})
		return
	}

	log.Printf("UploadSubmission: read %d bytes from saved file", len(fileBytes))

	encoded := base64.StdEncoding.EncodeToString(fileBytes)
	log.Printf("UploadSubmission: base64 encoded length: %d", len(encoded))

	mimeType := formFile.Header.Get("Content-Type")
	if mimeType == "" {
		sample := fileBytes
		if len(sample) > 512 {
			sample = sample[:512]
		}
		mimeType = http.DetectContentType(sample)
	}

	log.Printf("UploadSubmission: detected MIME type: %s", mimeType)

	promptDoc, err := h.resolvePrompt(c)
	if err != nil {
		log.Printf("error: unable to load evaluation prompt: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to load evaluation prompt"})
		return
	}

	log.Printf("UploadSubmission: loaded prompt: %s", promptDoc.Title)

	constraintLines := []string{
		fmt.Sprintf("Total Marks: %.2f", maxScore),
		fmt.Sprintf("Submission Title: %s", title),
	}
	if subject != "" {
		constraintLines = append([]string{fmt.Sprintf("Subject: %s", subject)}, constraintLines...)
	}

	request := services.EvaluationRequest{
		Prompt:      promptDoc.SystemPrompt,
		Constraints: strings.Join(constraintLines, "\n"),
		File: services.EvaluationFile{
			Name:     formFile.Filename,
			MimeType: mimeType,
			Data:     encoded,
		},
	}

	log.Printf("UploadSubmission: calling AI service for evaluation")

	aiResp, err := services.EvaluateSubmission(request)
	if err != nil {
		var evalErr *services.EvaluationError
		if errors.As(err, &evalErr) {
			log.Printf("warning: AI evaluation failed with status %d: %s", evalErr.StatusCode, evalErr.Body)
			if evalErr.StatusCode == http.StatusTooManyRequests {
				c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AI service quota exceeded. Please try again in a few minutes."})
				return
			}
			c.JSON(http.StatusBadGateway, gin.H{"error": "AI service is unavailable. Please try again later."})
			return
		}
		log.Printf("warning: AI evaluation failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to evaluate submission"})
		return
	}

	log.Printf("UploadSubmission: AI evaluation successful - score: %.2f/%.2f", aiResp.Score, aiResp.MaxScore)

	alignmentWarning := strings.TrimSpace(aiResp.AlignmentWarning)
	if alignmentWarning == "" {
		alignmentWarning = utils.EvaluateAlignment(
			subject,
			title,
			promptDoc.Title,
			promptDoc.SystemPrompt,
			aisResp.Transcript,
			aisResp.Reasoning,
		)
	}
	if alignmentWarning != "" {
		log.Printf("warning: AI detected prompt/content mismatch: %s", alignmentWarning)
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"error":   "submission_misaligned",
			"details": alignmentWarning,
			"alignmentWarning": alignmentWarning,
			"hint":    "Update the subject, title, and prompt so they match the uploaded answers, then submit again.",
		})
		return
	}

	submission := models.Submission{
		ID:         primitive.NewObjectID(),
		Title:      title,
		Subject:    subject,
		FileName:   formFile.Filename,
		StoredPath: storedPath,
		MimeType:   mimeType,
		Score:      aiResp.Score,
		MaxScore:   resolveMaxScore(aiResp.MaxScore, maxScore),
		Reasoning:  aiResp.Reasoning,
		Transcript: strings.TrimSpace(aiResp.Transcript),
		AlignmentWarning: alignmentWarning,
		RubricUsed: promptDoc.SystemPrompt,
		CreatedAt:  time.Now().UTC(),
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if _, err := h.submissions.InsertOne(ctx, submission); err != nil {
		log.Printf("error: unable to persist submission to DB: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to persist submission"})
		return
	}

	log.Printf("UploadSubmission: submission saved to DB with ID: %s", submission.ID.Hex())

	c.JSON(http.StatusCreated, submission)
}

// ListSubmissions returns all stored submissions ordered by creation time.
func (h *SubmissionHandler) ListSubmissions(c *gin.Context) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	opts := options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}})
	cursor, err := h.submissions.Find(ctx, bson.M{}, opts)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to query submissions"})
		return
	}
	defer cursor.Close(ctx)

	var submissions []models.Submission
	if err := cursor.All(ctx, &submissions); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to decode submissions"})
		return
	}

	c.JSON(http.StatusOK, submissions)
}

func (h *SubmissionHandler) resolvePrompt(c *gin.Context) (models.Prompt, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var prompt models.Prompt
	err := h.prompts.FindOne(ctx, bson.M{"slug": "default"}).Decode(&prompt)
	if err == nil {
		return prompt, nil
	}
	if err == mongo.ErrNoDocuments {
		// fallback to default prompt from prompt handler helper
		prompt = models.Prompt{
			ID:           primitive.NewObjectID(),
			Slug:         "default",
			Title:        "Default Grading Prompt",
			SystemPrompt: defaultPrompt(),
			UpdatedAt:    time.Now().UTC(),
		}
		return prompt, nil
	}
	return models.Prompt{}, err
}

func sanitizeFileName(name string) string {
	cleaned := strings.ReplaceAll(name, " ", "_")
	return strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '_' || r == '-' {
			return r
		}
		return '-'
	}, cleaned)
}

func resolveMaxScore(aiMax, fallback float64) float64 {
	if aiMax > 0 {
		return aiMax
	}
	return fallback
}
