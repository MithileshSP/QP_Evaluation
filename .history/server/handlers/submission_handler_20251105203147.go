package handlers

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"math"
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
	"github.com/example/clg-qps/server/services"
	"github.com/example/clg-qps/server/utils"
)

// SubmissionHandler manages learner uploads and retrieval.
type SubmissionHandler struct {
	submissions *mongo.Collection
	prompts     *mongo.Collection
	assessments *mongo.Collection
}

const defaultAssessmentSlug = "current"

var errInvalidAssessmentID = errors.New("invalid assessment id")

type evaluationAssets struct {
	Assessment   models.Assessment
	Prompt       models.Prompt
	Subject      string
	GradeLevel   string
	CohortType   string
	MaxScore     float64
	QuestionName string
	QuestionMime string
	QuestionData string
	AnswerName   string
	AnswerMime   string
	AnswerData   string
}

type submissionHTTPError struct {
	status  int
	message string
}

func (e *submissionHTTPError) Error() string {
	return e.message
}

// NewSubmissionHandler constructs a SubmissionHandler.
func NewSubmissionHandler(db *mongo.Database) *SubmissionHandler {
	submissionCollection := db.Collection("submissions")
	ensureSubmissionIndexes(submissionCollection)
	return &SubmissionHandler{
		submissions: submissionCollection,
		prompts:     db.Collection("prompts"),
		assessments: db.Collection("assessments"),
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

	if formFile.Size == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is empty"})
		return
	}

	assessmentID := strings.TrimSpace(c.PostForm("assessmentId"))
	assessment, err := h.resolveAssessment(c.Request.Context(), assessmentID)
	if err != nil {
		if errors.Is(err, errInvalidAssessmentID) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid assessment id"})
			return
		}
		if errors.Is(err, mongo.ErrNoDocuments) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "assessment not available"})
			return
		}
		log.Printf("error: unable to resolve assessment: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to load assessment"})
		return
	}
	if assessment.ID.IsZero() || assessment.QuestionPaper == nil || assessment.AnswerKey == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "assessment is incomplete"})
		return
	}

	subject := strings.TrimSpace(c.PostForm("subject"))
	if subject == "" {
		subject = strings.TrimSpace(assessment.Subject)
	}
	if subject != "" {
		log.Printf("UploadSubmission: subject resolved -> %s", subject)
	}
	gradeLevel := strings.TrimSpace(assessment.Grade)
	if gradeLevel != "" {
		log.Printf("UploadSubmission: grade resolved -> %s", gradeLevel)
	}

	maxScore := assessment.MaxScore
	if maxScore <= 0 {
		maxScore = 10.0
	}
	if raw := c.PostForm("maxScore"); raw != "" {
		if parsed, parseErr := strconv.ParseFloat(raw, 64); parseErr == nil && parsed > 0 {
			maxScore = parsed
		}
	}

	uploadsDir, err := ensureUploadsDir()
	if err != nil {
		log.Printf("error: unable to prepare upload directory: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to prepare upload directory"})
		return
	}

	assets, err := h.prepareEvaluationAssets(c, assessment, subject, gradeLevel, maxScore)
	if err != nil {
		log.Printf("error: unable to prepare evaluation assets: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to prepare evaluation assets"})
		return
	}

	submission, err := h.evaluateAndStoreSubmission(c, assets, formFile, c.PostForm("title"), uploadsDir)
	if err != nil {
		var httpErr *submissionHTTPError
		if errors.As(err, &httpErr) {
			c.JSON(httpErr.status, gin.H{"error": httpErr.message})
			return
		}
		log.Printf("error: unable to evaluate submission: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to evaluate submission"})
		return
	}

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

func (h *SubmissionHandler) resolveAssessment(parent context.Context, assessmentID string) (models.Assessment, error) {
	ctx, cancel := context.WithTimeout(parent, 5*time.Second)
	defer cancel()

	filter := bson.M{"slug": defaultAssessmentSlug}
	if assessmentID != "" {
		objID, err := primitive.ObjectIDFromHex(assessmentID)
		if err != nil {
			return models.Assessment{}, errInvalidAssessmentID
		}
		filter = bson.M{"_id": objID}
	}

	var assessment models.Assessment
	if err := h.assessments.FindOne(ctx, filter).Decode(&assessment); err != nil {
		return models.Assessment{}, err
	}
	return assessment, nil
}

func convertBreakdown(items []services.QuestionBreakdown) []models.QuestionBreakdown {
	if len(items) == 0 {
		return nil
	}
	result := make([]models.QuestionBreakdown, 0, len(items))
	for _, item := range items {
		score := item.Score
		maxScore := item.MaxScore
		if maxScore < 0 {
			log.Printf("warning: AI returned negative maxScore %.2f for question %s; clamping to 0", maxScore, item.QuestionNumber)
			maxScore = 0
		}
		if score < 0 {
			log.Printf("warning: AI returned negative score %.2f for question %s; clamping to 0", score, item.QuestionNumber)
			score = 0
		}
		if maxScore > 0 && score > maxScore {
			log.Printf("warning: AI returned score %.2f exceeding max %.2f for question %s; clamping", score, maxScore, item.QuestionNumber)
			score = maxScore
		}
		result = append(result, models.QuestionBreakdown{
			QuestionNumber: strings.TrimSpace(item.QuestionNumber),
			Score:          score,
			MaxScore:       maxScore,
			Reason:         strings.TrimSpace(item.Reason),
		})
	}
	return result
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
	if fallback <= 0 {
		if aiMax > 0 {
			return aiMax
		}
		return 0
	}
	if aiMax <= 0 {
		return fallback
	}
	if aiMax < fallback {
		return fallback
	}
	return aiMax
}
