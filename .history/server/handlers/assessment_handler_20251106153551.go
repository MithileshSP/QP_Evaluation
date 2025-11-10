package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
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
		log.Printf("warning: unable to ensure assessment index: %v", err)
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
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Minute)
	defer cancel()

	existing, err := h.fetchAssessment(ctx, currentAssessmentSlug)
	if err != nil && !errors.Is(err, mongo.ErrNoDocuments) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to load existing assessment"})
		return
	}
	if errors.Is(err, mongo.ErrNoDocuments) {
		existing = models.Assessment{}
	}

	file, err := c.FormFile("questionPaper")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "questionPaper file is required"})
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

	storedQuestion, storeErr := storeAssessmentFile(c, file, assessmentDir)
	if storeErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": storeErr.Error()})
		return
	}
	cleanupQuestion := true
	defer func() {
		if cleanupQuestion {
			removeIfExists(storedQuestion.StoredPath)
		}
	}()

	analysis, err := h.analyzeQuestionPaper(ctx, storedQuestion)
	if err != nil {
		var analysisErr *services.AnalysisError
		if errors.As(err, &analysisErr) {
			message := strings.TrimSpace(analysisErr.Body)
			if message == "" {
				message = "analysis service returned an error"
			}
			c.JSON(http.StatusBadGateway, gin.H{"error": message})
			return
		}
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "question paper analysis timed out"})
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": "unable to analyze question paper"})
		return
	}

	title := firstNonEmpty(
		analysis.Title,
		existing.Title,
		strings.TrimSuffix(storedQuestion.FileName, filepath.Ext(storedQuestion.FileName)),
		"Assessment",
	)
	subject := firstNonEmpty(analysis.Subject, existing.Subject, "General Studies")
	cohortType := canonicalCohortType(analysis.CohortType, existing.CohortType)
	grade := firstNonEmpty(analysis.Grade, existing.Grade)
	if grade == "" {
		grade = defaultGradeFor(cohortType)
	}

	maxScore := analysis.MaxScore
	if maxScore <= 0 {
		maxScore = sumQuestionMaxScores(analysis.Questions)
	}
	if maxScore <= 0 && existing.MaxScore > 0 {
		maxScore = existing.MaxScore
	}
	if maxScore <= 0 {
		maxScore = 100
	}

	answerKeyMeta, err := persistGeneratedAnswerKey(assessmentDir, analysis, cohortType, grade, maxScore)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to store generated answer key"})
		return
	}
	cleanupAnswer := true
	defer func() {
		if cleanupAnswer {
			removeIfExists(answerKeyMeta.StoredPath)
		}
	}()

	now := time.Now().UTC()
	setFields := bson.M{
		"title":         title,
		"subject":       subject,
		"cohort_type":   cohortType,
		"grade":         grade,
		"max_score":     maxScore,
		"question_paper": storedQuestion,
		"answer_key":     answerKeyMeta,
		"updated_at":    now,
	}

	update := bson.M{
		"$set": setFields,
		"$setOnInsert": bson.M{
			"_id":        primitive.NewObjectID(),
			"slug":       currentAssessmentSlug,
			"created_at": now,
		},
	}

	_, err = h.assessments.UpdateOne(ctx, bson.M{"slug": currentAssessmentSlug}, update, options.Update().SetUpsert(true))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to persist assessment"})
		return
	}

	cleanupQuestion = false
	cleanupAnswer = false
	if existing.QuestionPaper != nil {
		removeIfExists(existing.QuestionPaper.StoredPath)
	}
	if existing.AnswerKey != nil {
		removeIfExists(existing.AnswerKey.StoredPath)
	}

	ctxFetch, cancelFetch := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFetch()
	var updated models.Assessment
	if err := h.assessments.FindOne(ctxFetch, bson.M{"slug": currentAssessmentSlug}).Decode(&updated); err != nil {
		updated = models.Assessment{
			Slug:          currentAssessmentSlug,
			Title:         title,
			Subject:       subject,
			CohortType:    cohortType,
			Grade:         grade,
			MaxScore:      maxScore,
			QuestionPaper: storedQuestion,
			AnswerKey:     answerKeyMeta,
			UpdatedAt:     now,
		}
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

func (h *AssessmentHandler) analyzeQuestionPaper(ctx context.Context, question *models.AssetMeta) (*services.QuestionPaperAnalysis, error) {
	if question == nil || question.StoredPath == "" {
		return nil, errors.New("question paper is missing")
	}

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}

	data, err := os.ReadFile(question.StoredPath)
	if err != nil {
		return nil, fmt.Errorf("read question paper: %w", err)
	}

	mimeType := strings.TrimSpace(question.MimeType)
	if mimeType == "" {
		sample := data
		if len(sample) > 512 {
			sample = sample[:512]
		}
		mimeType = http.DetectContentType(sample)
	}
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	name := strings.TrimSpace(question.FileName)
	if name == "" {
		name = filepath.Base(question.StoredPath)
	}

	req := services.QuestionPaperAnalysisRequest{
		QuestionPaper: services.EvaluationFile{
			Role:     services.FileRoleQuestionPaper,
			Name:     name,
			MimeType: mimeType,
			Data:     base64.StdEncoding.EncodeToString(data),
		},
	}

	return services.AnalyzeQuestionPaper(req)
}

func persistGeneratedAnswerKey(dir string, analysis *services.QuestionPaperAnalysis) (*models.AssetMeta, error) {
	if analysis == nil {
		return nil, errors.New("analysis payload missing")
	}

	payload := map[string]any{
		"title":     strings.TrimSpace(analysis.Title),
		"subject":   strings.TrimSpace(analysis.Subject),
		"cohortType": canonicalCohortType(analysis.CohortType, ""),
		"grade":     strings.TrimSpace(analysis.Grade),
		"maxScore":  analysis.MaxScore,
		"generatedAt": time.Now().UTC().Format(time.RFC3339),
		"questions": analysis.Questions,
	}
	if strings.TrimSpace(analysis.Notes) != "" {
		payload["notes"] = strings.TrimSpace(analysis.Notes)
	}

	bytes, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("encode generated answer key: %w", err)
	}

	sanitizedTitle := sanitizeFileName(strings.TrimSpace(analysis.Title))
	if sanitizedTitle == "" {
		sanitizedTitle = "assessment"
	}
	fileName := fmt.Sprintf("%d_auto_answer_key_%s.json", time.Now().UnixNano(), sanitizedTitle)
	storedPath := filepath.Join(dir, fileName)
	if err := os.WriteFile(storedPath, bytes, 0o644); err != nil {
		return nil, fmt.Errorf("write generated answer key: %w", err)
	}

	displayName := strings.TrimSpace(analysis.Title)
	if displayName == "" {
		displayName = "Auto Answer Key"
	} else {
		displayName = fmt.Sprintf("Auto Answer Key - %s", displayName)
	}

	return &models.AssetMeta{
		FileName:   fmt.Sprintf("%s.json", displayName),
		StoredPath: storedPath,
		MimeType:   "application/json",
		Size:       int64(len(bytes)),
		UploadedAt: time.Now().UTC(),
	}, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func canonicalCohortType(primary, fallback string) string {
	for _, candidate := range []string{primary, fallback} {
		normalized := strings.ToLower(strings.TrimSpace(candidate))
		switch normalized {
		case "college", "engineering", "university":
			return "college"
		case "school":
			return "school"
		}
	}
	return "school"
}

func defaultGradeFor(cohortType string) string {
	if strings.ToLower(strings.TrimSpace(cohortType)) == "college" {
		return "Semester 1"
	}
	return "Grade 10"
}

func sumQuestionMaxScores(questions []services.QuestionPaperDescriptor) float64 {
	var total float64
	for _, q := range questions {
		if q.MaxScore > 0 {
			total += q.MaxScore
		}
	}
	return total
}

func removeIfExists(path string) {
	if path == "" {
		return
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		log.Printf("warning: unable to remove file %s: %v", path, err)
	}
}
