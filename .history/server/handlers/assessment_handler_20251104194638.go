package handlers

import (
	"context"
	"errors"
	"fmt"
	"mime/multipart"
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
)

const currentAssessmentSlug = "current"

// AssessmentHandler manages the question paper and answer key lifecycle.
type AssessmentHandler struct {
	assessments *mongo.Collection
}

// NewAssessmentHandler constructs an AssessmentHandler.
func NewAssessmentHandler(db *mongo.Database) *AssessmentHandler {
	collection := db.Collection("assessments")
	ensureAssessmentIndexes(collection)
	return &AssessmentHandler{assessments: collection}
}

func ensureAssessmentIndexes(col *mongo.Collection) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	index := mongo.IndexModel{
		Keys:    bson.D{{Key: "slug", Value: 1}},
		Options: options.Index().SetUnique(true).SetName("slug_unique"),
	}
	if _, err := col.Indexes().CreateOne(ctx, index); err != nil {
		// index creation failure should not crash the server; log at debug level if necessary
		fmt.Printf("warning: unable to ensure assessment index: %v\n", err)
	}
}

// GetCurrentAssessment returns the stored question paper and answer key metadata.
func (h *AssessmentHandler) GetCurrentAssessment(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	assessment, err := h.fetchAssessment(ctx, currentAssessmentSlug)
	if errors.Is(err, mongo.ErrNoDocuments) {
		c.JSON(http.StatusOK, gin.H{"slug": currentAssessmentSlug})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to load assessment"})
		return
	}

	c.JSON(http.StatusOK, assessment)
}

// UpsertCurrentAssessment accepts updated metadata and optional replacement files.
func (h *AssessmentHandler) UpsertCurrentAssessment(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()

	existing, err := h.fetchAssessment(ctx, currentAssessmentSlug)
	if err != nil && !errors.Is(err, mongo.ErrNoDocuments) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to load existing assessment"})
		return
	}

	title := strings.TrimSpace(c.PostForm("title"))
	if title == "" {
		title = existing.Title
	}
	subject := strings.TrimSpace(c.PostForm("subject"))
	if subject == "" {
		subject = existing.Subject
	}
	if title == "" || subject == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "title and subject are required"})
		return
	}

	maxScore := existing.MaxScore
	if raw := strings.TrimSpace(c.PostForm("maxScore")); raw != "" {
		parsed, parseErr := strconv.ParseFloat(raw, 64)
		if parseErr != nil || parsed <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "maxScore must be a positive number"})
			return
		}
		maxScore = parsed
	}
	if maxScore <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "maxScore must be provided"})
		return
	}

	uploadsDir := os.Getenv("UPLOADS_DIR")
	if uploadsDir == "" {
		uploadsDir = "uploads"
	}
	assessmentDir := filepath.Join(uploadsDir, "assessments", currentAssessmentSlug)
	if err := os.MkdirAll(assessmentDir, 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to prepare storage"})
		return
	}

	var newQuestion *models.AssetMeta
	if file, err := c.FormFile("questionPaper"); err == nil {
		stored, storeErr := storeAssessmentFile(c, file, assessmentDir)
		if storeErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": storeErr.Error()})
			return
		}
		newQuestion = stored
	}

	var newAnswer *models.AssetMeta
	if file, err := c.FormFile("answerKey"); err == nil {
		stored, storeErr := storeAssessmentFile(c, file, assessmentDir)
		if storeErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": storeErr.Error()})
			return
		}
		newAnswer = stored
	}

	if existing.QuestionPaper == nil && newQuestion == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "questionPaper file is required"})
		return
	}
	if existing.AnswerKey == nil && newAnswer == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "answerKey file is required"})
		return
	}

	now := time.Now().UTC()
	setFields := bson.M{
		"title":     title,
		"subject":   subject,
		"max_score": maxScore,
		"updated_at": now,
	}
	if newQuestion != nil {
		setFields["question_paper"] = newQuestion
	}
	if newAnswer != nil {
		setFields["answer_key"] = newAnswer
	}

	update := bson.M{
		"$set": setFields,
		"$setOnInsert": bson.M{
			"_id":        primitive.NewObjectID(),
			"slug":       currentAssessmentSlug,
			"created_at": now,
		},
	}

	result, err := h.assessments.UpdateOne(ctx, bson.M{"slug": currentAssessmentSlug}, update, options.Update().SetUpsert(true))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to persist assessment"})
		return
	}

	// Clean up replaced files after successful update.
	if newQuestion != nil && existing.QuestionPaper != nil {
		removeIfExists(existing.QuestionPaper.StoredPath)
	}
	if newAnswer != nil && existing.AnswerKey != nil {
		removeIfExists(existing.AnswerKey.StoredPath)
	}

	var updated models.Assessment
	if result.UpsertedID != nil {
		updated = models.Assessment{}
	} else {
		updated = existing
	}
	ctxFetch, cancelFetch := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFetch()
	if err := h.assessments.FindOne(ctxFetch, bson.M{"slug": currentAssessmentSlug}).Decode(&updated); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"slug":        currentAssessmentSlug,
			"title":       title,
			"subject":     subject,
			"maxScore":    maxScore,
			"updatedAt":   now,
			"questionPaper": newQuestion,
			"answerKey":    newAnswer,
		})
		return
	}

	c.JSON(http.StatusOK, updated)
}

func (h *AssessmentHandler) fetchAssessment(ctx context.Context, slug string) (models.Assessment, error) {
	var assessment models.Assessment
	err := h.assessments.FindOne(ctx, bson.M{"slug": slug}).Decode(&assessment)
	return assessment, err
}

func storeAssessmentFile(c *gin.Context, file *multipart.FileHeader, dir string) (*models.AssetMeta, error) {
	safeName := fmt.Sprintf("%d_%s", time.Now().UnixNano(), sanitizeFileName(file.Filename))
	storedPath := filepath.Join(dir, safeName)
	if err := c.SaveUploadedFile(file, storedPath); err != nil {
		return nil, fmt.Errorf("unable to store file: %w", err)
	}
	return &models.AssetMeta{
		FileName:   file.Filename,
		StoredPath: storedPath,
		MimeType:   file.Header.Get("Content-Type"),
		Size:       file.Size,
		UploadedAt: time.Now().UTC(),
	}, nil
}

func removeIfExists(path string) {
	if path == "" {
		return
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		fmt.Printf("warning: unable to remove file %s: %v\n", path, err)
	}
}