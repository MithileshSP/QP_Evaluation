package handlers

import (
	"context"
	"encoding/base64"
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
		Keys:    bson.D{{Key: "user_id", Value: 1}, {Key: "created_at", Value: -1}},
		Options: options.Index().SetName("user_created_at"),
	}
	if _, err := col.Indexes().CreateOne(ctx, indexModel); err != nil {
		log.Printf("warning: unable to ensure submissions index: %v", err)
	}
}

// UploadSubmission handles file uploads and triggers AI evaluation.
func (h *SubmissionHandler) UploadSubmission(c *gin.Context) {
	userIDHex := c.GetString("userId")
	userID, err := primitive.ObjectIDFromHex(userIDHex)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	formFile, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}

	if formFile.Size == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is empty"})
		return
	}

	// Derive additional metadata.
	title := c.PostForm("title")
	if title == "" {
		title = strings.TrimSuffix(formFile.Filename, filepath.Ext(formFile.Filename))
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

	if err := c.SaveUploadedFile(formFile, storedPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to save file"})
		return
	}

	fileBytes, err := os.ReadFile(storedPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to read saved file"})
		return
	}

	encoded := base64.StdEncoding.EncodeToString(fileBytes)

	mimeType := formFile.Header.Get("Content-Type")
	if mimeType == "" {
		sample := fileBytes
		if len(sample) > 512 {
			sample = sample[:512]
		}
		mimeType = http.DetectContentType(sample)
	}

	promptDoc, err := h.resolvePrompt(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to load evaluation prompt"})
		return
	}

	request := services.EvaluationRequest{
		Prompt:      promptDoc.SystemPrompt,
		Constraints: fmt.Sprintf("Total Marks: %.2f\nSubmission Title: %s", maxScore, title),
		File: services.EvaluationFile{
			Name:     formFile.Filename,
			MimeType: mimeType,
			Data:     encoded,
		},
	}

	aiResp, err := services.EvaluateSubmission(request)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to evaluate submission"})
		return
	}

	submission := models.Submission{
		ID:         primitive.NewObjectID(),
		UserID:     userID,
		FileName:   formFile.Filename,
		StoredPath: storedPath,
	MimeType:   mimeType,
		Score:      aiResp.Score,
		MaxScore:   resolveMaxScore(aiResp.MaxScore, maxScore),
		Reasoning:  aiResp.Reasoning,
		RubricUsed: promptDoc.SystemPrompt,
		CreatedAt:  time.Now().UTC(),
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if _, err := h.submissions.InsertOne(ctx, submission); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to persist submission"})
		return
	}

	c.JSON(http.StatusCreated, submission)
}

// ListSubmissions returns submissions filtered by role.
func (h *SubmissionHandler) ListSubmissions(c *gin.Context) {
	role := c.GetString("role")
	filter := bson.M{}

	if role != string(models.RoleAdmin) {
		userIDHex := c.GetString("userId")
		userID, err := primitive.ObjectIDFromHex(userIDHex)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
			return
		}
		filter["user_id"] = userID
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	opts := options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}})
	cursor, err := h.submissions.Find(ctx, filter, opts)
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
