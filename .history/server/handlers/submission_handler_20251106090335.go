package handlers

import (
	"archive/zip"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"io/fs"
	"log"
	"math"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

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

type batchSummaryRow struct {
	Title        string  `json:"title"`
	FileName     string  `json:"fileName"`
	Score        float64 `json:"score"`
	MaxScore     float64 `json:"maxScore"`
	RelativePath string  `json:"relativePath"`
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

// UploadBulkSubmissions evaluates and stores multiple learner submissions in a single request.
func (h *SubmissionHandler) UploadBulkSubmissions(c *gin.Context) {
	log.Printf("UploadBulkSubmissions: received request")

	form, err := c.MultipartForm()
	if err != nil {
		log.Printf("error: unable to parse multipart form: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid multipart form data"})
		return
	}

	var fileHeaders []*multipart.FileHeader
	if form != nil {
		if batch, ok := form.File["files"]; ok {
			fileHeaders = append(fileHeaders, batch...)
		}
		if batch, ok := form.File["submissions"]; ok {
			fileHeaders = append(fileHeaders, batch...)
		}
	}

	if len(fileHeaders) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "at least one submission file is required"})
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
	gradeLevel := strings.TrimSpace(assessment.Grade)

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

	titleOverride := c.PostForm("title")
	titlePrefix := strings.TrimSpace(c.PostForm("titlePrefix"))
	titles := c.PostFormArray("titles")

	results := make([]models.Submission, 0, len(fileHeaders))
	errorsOut := make([]gin.H, 0)

	for idx, file := range fileHeaders {
		if file == nil {
			continue
		}
		if file.Size == 0 {
			log.Printf("warning: skipping empty file in bulk upload: %s", file.Filename)
			errorsOut = append(errorsOut, gin.H{
				"fileName": file.Filename,
				"status":   http.StatusBadRequest,
				"error":    "file is empty",
			})
			continue
		}

		override := titleOverride
		if override == "" {
			if idx < len(titles) {
				override = strings.TrimSpace(titles[idx])
			}
			if override == "" && titlePrefix != "" {
				override = fmt.Sprintf("%s %02d", titlePrefix, idx+1)
			}
		}

		submission, evalErr := h.evaluateAndStoreSubmission(c, assets, file, override, uploadsDir)
		if evalErr != nil {
			var httpErr *submissionHTTPError
			if errors.As(evalErr, &httpErr) {
				errorsOut = append(errorsOut, gin.H{
					"fileName": file.Filename,
					"status":   httpErr.status,
					"error":    httpErr.message,
				})
				continue
			}
			log.Printf("error: bulk evaluation failed for %s: %v", file.Filename, evalErr)
			errorsOut = append(errorsOut, gin.H{
				"fileName": file.Filename,
				"status":   http.StatusInternalServerError,
				"error":    "unable to evaluate submission",
			})
			continue
		}

		results = append(results, submission)
	}

	switch {
	case len(results) == 0 && len(errorsOut) > 0:
		c.JSON(http.StatusBadRequest, gin.H{
			"count":       0,
			"submissions": []models.Submission{},
			"errors":      errorsOut,
		})
	case len(errorsOut) > 0:
		log.Printf("UploadBulkSubmissions: completed with %d successes and %d failures", len(results), len(errorsOut))
		payload := gin.H{
			"count":       len(results),
			"submissions": results,
			"errors":      errorsOut,
		}
		if bundleURL := h.tryGenerateBatchBundle(uploadsDir, titlePrefix, titleOverride, results); bundleURL != "" {
			payload["bundleDownloadUrl"] = bundleURL
		}
		c.JSON(http.StatusMultiStatus, payload)
	default:
		log.Printf("UploadBulkSubmissions: completed successfully with %d submissions", len(results))
		payload := gin.H{
			"count":       len(results),
			"submissions": results,
			"errors":      []gin.H{},
		}
		if bundleURL := h.tryGenerateBatchBundle(uploadsDir, titlePrefix, titleOverride, results); bundleURL != "" {
			payload["bundleDownloadUrl"] = bundleURL
		}
		c.JSON(http.StatusCreated, payload)
	}
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

	for i := range submissions {
		if submissions[i].ExportBundleReady && submissions[i].ExportBundlePath != "" && !submissions[i].ID.IsZero() {
			submissions[i].ExportDownloadURL = fmt.Sprintf("/api/submissions/%s/export", submissions[i].ID.Hex())
		}
	}

	c.JSON(http.StatusOK, submissions)
}

// DownloadSubmissionExport streams a prepared evaluation bundle as a zip archive.
func (h *SubmissionHandler) DownloadSubmissionExport(c *gin.Context) {
	submissionID := strings.TrimSpace(c.Param("id"))
	if submissionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "submission id is required"})
		return
	}

	objID, err := primitive.ObjectIDFromHex(submissionID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid submission id"})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var submission models.Submission
	if err := h.submissions.FindOne(ctx, bson.M{"_id": objID}).Decode(&submission); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			c.JSON(http.StatusNotFound, gin.H{"error": "submission not found"})
			return
		}
		log.Printf("error: unable to load submission %s for export: %v", submissionID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to load submission"})
		return
	}

	if !submission.ExportBundleReady || submission.ExportBundlePath == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "export bundle not available for this submission"})
		return
	}

	if _, statErr := os.Stat(submission.ExportBundlePath); statErr != nil {
		log.Printf("warning: export bundle missing for submission %s: %v", submission.ID.Hex(), statErr)
		c.JSON(http.StatusGone, gin.H{"error": "export bundle has expired; re-run the evaluation"})
		return
	}

	fileName := filepath.Base(submission.ExportBundlePath)
	c.FileAttachment(submission.ExportBundlePath, fileName)
}

// DownloadBatchExport streams a combined batch export zip created from bulk uploads.
func (h *SubmissionHandler) DownloadBatchExport(c *gin.Context) {
	fileName := strings.TrimSpace(c.Param("name"))
	if fileName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "export name is required"})
		return
	}
	if fileName != filepath.Base(fileName) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid export name"})
		return
	}

	uploadsDir, err := ensureUploadsDir()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to resolve export directory"})
		return
	}

	fullPath := filepath.Join(uploadsDir, "exports", "batches", fileName)
	if _, statErr := os.Stat(fullPath); statErr != nil {
		if os.IsNotExist(statErr) {
			c.JSON(http.StatusNotFound, gin.H{"error": "batch export not found"})
			return
		}
		log.Printf("error: unable to access batch export %s: %v", fileName, statErr)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to read batch export"})
		return
	}

	c.FileAttachment(fullPath, fileName)
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

func ensureUploadsDir() (string, error) {
	uploadsDir := os.Getenv("UPLOADS_DIR")
	if uploadsDir == "" {
		uploadsDir = "uploads"
	}
	if err := os.MkdirAll(uploadsDir, 0o755); err != nil {
		return "", err
	}
	return uploadsDir, nil
}

func (h *SubmissionHandler) prepareEvaluationAssets(
	c *gin.Context,
	assessment models.Assessment,
	subject string,
	gradeLevel string,
	maxScore float64,
) (evaluationAssets, error) {
	promptDoc, err := h.resolvePrompt(c)
	if err != nil {
		return evaluationAssets{}, err
	}

	questionBytes, err := os.ReadFile(assessment.QuestionPaper.StoredPath)
	if err != nil {
		return evaluationAssets{}, err
	}
	questionEncoded := base64.StdEncoding.EncodeToString(questionBytes)
	questionMime := strings.TrimSpace(assessment.QuestionPaper.MimeType)
	if questionMime == "" {
		sample := questionBytes
		if len(sample) > 512 {
			sample = sample[:512]
		}
		questionMime = http.DetectContentType(sample)
	}
	if questionMime == "" {
		questionMime = "application/octet-stream"
	}
	questionName := strings.TrimSpace(assessment.QuestionPaper.FileName)
	if questionName == "" {
		questionName = filepath.Base(assessment.QuestionPaper.StoredPath)
	}

	answerBytes, err := os.ReadFile(assessment.AnswerKey.StoredPath)
	if err != nil {
		return evaluationAssets{}, err
	}
	answerEncoded := base64.StdEncoding.EncodeToString(answerBytes)
	answerMime := strings.TrimSpace(assessment.AnswerKey.MimeType)
	if answerMime == "" {
		sample := answerBytes
		if len(sample) > 512 {
			sample = sample[:512]
		}
		answerMime = http.DetectContentType(sample)
	}
	if answerMime == "" {
		answerMime = "application/octet-stream"
	}
	answerName := strings.TrimSpace(assessment.AnswerKey.FileName)
	if answerName == "" {
		answerName = filepath.Base(assessment.AnswerKey.StoredPath)
	}

	trimmedSubject := strings.TrimSpace(subject)
	trimmedGrade := strings.TrimSpace(gradeLevel)
	trimmedCohort := strings.TrimSpace(assessment.CohortType)
	if maxScore <= 0 {
		maxScore = 10.0
	}

	return evaluationAssets{
		Assessment:   assessment,
		Prompt:       promptDoc,
		Subject:      trimmedSubject,
		GradeLevel:   trimmedGrade,
		CohortType:   trimmedCohort,
		MaxScore:     maxScore,
		QuestionName: questionName,
		QuestionMime: questionMime,
		QuestionData: questionEncoded,
		AnswerName:   answerName,
		AnswerMime:   answerMime,
		AnswerData:   answerEncoded,
	}, nil
}

func (h *SubmissionHandler) evaluateAndStoreSubmission(
	c *gin.Context,
	assets evaluationAssets,
	formFile *multipart.FileHeader,
	titleOverride string,
	uploadsDir string,
) (models.Submission, error) {
	title := strings.TrimSpace(titleOverride)
	if title == "" {
		title = strings.TrimSuffix(formFile.Filename, filepath.Ext(formFile.Filename))
	}
	if title == "" {
		title = assets.Assessment.Title
	}
	if title == "" {
		title = "Student Answer Sheet"
	}

	safeFilename := fmt.Sprintf("%d_%s", time.Now().UnixNano(), sanitizeFileName(formFile.Filename))
	storedPath := filepath.Join(uploadsDir, safeFilename)

	if err := c.SaveUploadedFile(formFile, storedPath); err != nil {
		return models.Submission{}, fmt.Errorf("save file: %w", err)
	}

	cleanup := true
	defer func() {
		if cleanup {
			if err := os.Remove(storedPath); err != nil && !os.IsNotExist(err) {
				log.Printf("warning: unable to remove temp file %s: %v", storedPath, err)
			}
		}
	}()

	fileBytes, err := os.ReadFile(storedPath)
	if err != nil {
		return models.Submission{}, fmt.Errorf("read saved file: %w", err)
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

	constraintLines := []string{
		fmt.Sprintf("Assessment Title: %s", assets.Assessment.Title),
		fmt.Sprintf("Total Marks: %.2f", assets.MaxScore),
		fmt.Sprintf("Submission Title: %s", title),
		"Reference attachments: question_paper (exam content) and answer_key (correct responses).",
	}
	if assets.Subject != "" {
		constraintLines = append([]string{fmt.Sprintf("Subject: %s", assets.Subject)}, constraintLines...)
	}
	if assets.CohortType != "" {
		constraintLines = append([]string{fmt.Sprintf("Education Context: %s", assets.CohortType)}, constraintLines...)
	}
	if assets.GradeLevel != "" {
		constraintLines = append([]string{fmt.Sprintf("Grade Level: %s", assets.GradeLevel)}, constraintLines...)
	}

	promptText := strings.TrimSpace(assets.Prompt.SystemPrompt)
	if promptText == "" {
		promptText = defaultPrompt()
	}

	request := services.EvaluationRequest{
		Prompt:      promptText,
		Constraints: strings.Join(constraintLines, "\n"),
		Files: []services.EvaluationFile{
			{
				Role:     services.FileRoleQuestionPaper,
				Name:     assets.QuestionName,
				MimeType: assets.QuestionMime,
				Data:     assets.QuestionData,
			},
			{
				Role:     services.FileRoleAnswerKey,
				Name:     assets.AnswerName,
				MimeType: assets.AnswerMime,
				Data:     assets.AnswerData,
			},
			{
				Role:     services.FileRoleSubmission,
				Name:     formFile.Filename,
				MimeType: mimeType,
				Data:     encoded,
			},
		},
	}

	log.Printf(
		"UploadSubmission: evaluating %s for assessment %s",
		formFile.Filename,
		assets.Assessment.Title,
	)

	aiResp, err := services.EvaluateSubmission(request)
	if err != nil {
		var evalErr *services.EvaluationError
		if errors.As(err, &evalErr) {
			log.Printf("warning: AI evaluation failed with status %d: %s", evalErr.StatusCode, evalErr.Body)
			if evalErr.StatusCode == http.StatusTooManyRequests {
				return models.Submission{}, &submissionHTTPError{
					status:  http.StatusServiceUnavailable,
					message: "AI service quota exceeded. Please try again in a few minutes.",
				}
			}
			return models.Submission{}, &submissionHTTPError{
				status:  http.StatusBadGateway,
				message: "AI service is unavailable. Please try again later.",
			}
		}
		return models.Submission{}, fmt.Errorf("evaluate submission: %w", err)
	}

	log.Printf("UploadSubmission: AI evaluation successful - score: %.2f/%.2f", aiResp.Score, aiResp.MaxScore)

	alignmentWarning := strings.TrimSpace(aiResp.AlignmentWarning)
	if alignmentWarning == "" {
		alignmentWarning = utils.EvaluateAlignment(
			assets.Subject,
			title,
			assets.Prompt.Title,
			assets.Prompt.SystemPrompt,
			aiResp.Transcript,
			aiResp.Reasoning,
		)
	}
	alignmentWarning = strings.TrimSpace(alignmentWarning)
	if alignmentWarning != "" {
		log.Printf("warning: AI detected prompt/content mismatch: %s", alignmentWarning)
	}

	breakdown := convertBreakdown(aiResp.Breakdown)
	derivedScore := aiResp.Score
	derivedMax := resolveMaxScore(aiResp.MaxScore, assets.MaxScore)
	var breakdownScore, breakdownMax float64
	for _, item := range breakdown {
		breakdownScore += item.Score
		breakdownMax += item.MaxScore
	}

	const tolerance = 0.01
	alignmentNotes := make([]string, 0)
	if breakdownMax > 0 {
		if derivedMax <= 0 || math.Abs(breakdownMax-derivedMax) > tolerance {
			log.Printf(
				"warning: breakdown max total %.2f differs from overall max %.2f; adjusting",
				breakdownMax,
				derivedMax,
			)
			derivedMax = math.Max(breakdownMax, derivedMax)
			alignmentNotes = append(alignmentNotes, fmt.Sprintf("Adjusted overall max marks to %.2f to match breakdown totals.", derivedMax))
		}
		if derivedMax > 0 && breakdownScore > derivedMax {
			log.Printf(
				"warning: breakdown score %.2f exceeds overall max %.2f; clamping",
				breakdownScore,
				derivedMax,
			)
			breakdownScore = derivedMax
		}
	}
	if breakdownScore > 0 && math.Abs(derivedScore-breakdownScore) > tolerance {
		log.Printf(
			"warning: AI overall score %.2f mismatches breakdown total %.2f; adjusting",
			derivedScore,
			breakdownScore,
		)
		derivedScore = breakdownScore
		alignmentNotes = append(alignmentNotes, fmt.Sprintf("Adjusted overall score to %.2f so it matches the sum of per-question marks.", derivedScore))
	}

	submission := models.Submission{
		ID:               primitive.NewObjectID(),
		Title:            title,
		Subject:          assets.Subject,
		Grade:            assets.GradeLevel,
		CohortType:       assets.CohortType,
		AssessmentID:     assets.Assessment.ID,
		FileName:         formFile.Filename,
		StoredPath:       storedPath,
		MimeType:         mimeType,
		Score:            derivedScore,
		MaxScore:         derivedMax,
		Reasoning:        aiResp.Reasoning,
		Breakdown:        breakdown,
		Transcript:       strings.TrimSpace(aiResp.Transcript),
		AlignmentWarning: alignmentWarning,
		RubricUsed:       assets.Prompt.SystemPrompt,
		CreatedAt:        time.Now().UTC(),
	}
	if len(alignmentNotes) > 0 {
		combined := strings.TrimSpace(alignmentWarning)
		notes := strings.Join(alignmentNotes, " ")
		if combined == "" {
			submission.AlignmentWarning = notes
		} else {
			submission.AlignmentWarning = combined + " " + notes
		}
	}

	if err := h.generateEvaluationBundle(uploadsDir, storedPath, &submission, &assets); err != nil {
		log.Printf(
			"warning: unable to create export bundle for submission %s: %v",
			submission.ID.Hex(),
			err,
		)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if _, err := h.submissions.InsertOne(ctx, submission); err != nil {
		return models.Submission{}, fmt.Errorf("persist submission: %w", err)
	}

	cleanup = false
	if submission.ExportBundleReady {
		submission.ExportDownloadURL = fmt.Sprintf("/api/submissions/%s/export", submission.ID.Hex())
		log.Printf("UploadSubmission: export bundle available at %s", submission.ExportBundlePath)
	}
	log.Printf("UploadSubmission: submission saved to DB with ID: %s", submission.ID.Hex())
	return submission, nil
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

func (h *SubmissionHandler) generateEvaluationBundle(
	uploadsDir string,
	storedPath string,
	submission *models.Submission,
	assets *evaluationAssets,
) error {
	if submission == nil {
		return errors.New("submission is nil")
	}

	exportRoot := filepath.Join(uploadsDir, "exports")
	if err := os.MkdirAll(exportRoot, 0o755); err != nil {
		return err
	}

	folderLabel := strings.TrimSpace(submission.Title)
	if folderLabel == "" {
		folderLabel = strings.TrimSuffix(submission.FileName, filepath.Ext(submission.FileName))
	}
	if folderLabel == "" {
		folderLabel = "submission"
	}
	folderName := sanitizeFileName(folderLabel)
	if folderName == "" {
		folderName = "submission"
	}

	workingRoot := filepath.Join(exportRoot, submission.ID.Hex())
	if err := os.RemoveAll(workingRoot); err != nil && !os.IsNotExist(err) {
		return err
	}
	folderPath := filepath.Join(workingRoot, folderName)
	if err := os.MkdirAll(folderPath, 0o755); err != nil {
		return err
	}

	baseName := strings.TrimSuffix(submission.FileName, filepath.Ext(submission.FileName))
	baseSlug := sanitizeFileName(baseName)
	if baseSlug == "" {
		baseSlug = folderName
	}

	summaryPath := filepath.Join(folderPath, baseSlug+"-feedback.txt")
	summaryContent := buildEvaluationSummary(*submission, assets)
	if err := os.WriteFile(summaryPath, []byte(summaryContent), 0o644); err != nil {
		return err
	}

	jsonPayload := map[string]any{
		"id":               submission.ID.Hex(),
		"title":            submission.Title,
		"fileName":         submission.FileName,
		"score":            submission.Score,
		"maxScore":         submission.MaxScore,
		"reasoning":        submission.Reasoning,
		"alignmentWarning": submission.AlignmentWarning,
		"subject":          submission.Subject,
		"grade":            submission.Grade,
		"cohortType":       submission.CohortType,
		"createdAt":        submission.CreatedAt.Format(time.RFC3339),
		"breakdown":        submission.Breakdown,
		"transcript":       submission.Transcript,
	}
	if assets != nil {
		if assets.Assessment.Title != "" {
			jsonPayload["assessmentTitle"] = assets.Assessment.Title
		}
		if assets.Assessment.Subject != "" {
			jsonPayload["assessmentSubject"] = assets.Assessment.Subject
		}
	}
	jsonBytes, err := json.MarshalIndent(jsonPayload, "", "  ")
	if err != nil {
		return err
	}
	jsonPath := filepath.Join(folderPath, baseSlug+"-evaluation.json")
	if err := os.WriteFile(jsonPath, jsonBytes, 0o644); err != nil {
		return err
	}

	if len(submission.Breakdown) > 0 {
		csvContent := buildBreakdownCSV(submission.Breakdown)
		csvPath := filepath.Join(folderPath, baseSlug+"-breakdown.csv")
		if err := os.WriteFile(csvPath, []byte(csvContent), 0o644); err != nil {
			return err
		}
	}

	destName := ""

	if submission.Transcript != "" {
		transcriptPath := filepath.Join(folderPath, "transcript.txt")
		if err := os.WriteFile(transcriptPath, []byte(submission.Transcript), 0o644); err != nil {
			return err
		}
	}

	if storedPath != "" {
		destName = sanitizeFileNamePreserveExt(submission.FileName)
		if destName == "" {
			destName = filepath.Base(storedPath)
		}
		destPath := filepath.Join(folderPath, destName)
		if err := copyFile(storedPath, destPath); err != nil {
			log.Printf("warning: unable to copy submission file into export bundle: %v", err)
		}
	}

	if destName == "" {
		destName = submission.FileName
	}

	htmlContent := buildEvaluationHTML(*submission, assets, destName)
	htmlPath := filepath.Join(folderPath, "index.html")
	if err := os.WriteFile(htmlPath, []byte(htmlContent), 0o644); err != nil {
		return err
	}

	zipName := fmt.Sprintf("%s-%s.zip", folderName, submission.ID.Hex()[:8])
	zipPath := filepath.Join(exportRoot, zipName)
	if err := createZipFromFolder(zipPath, filepath.Dir(folderPath), folderPath); err != nil {
		return err
	}

	if err := os.RemoveAll(workingRoot); err != nil && !os.IsNotExist(err) {
		log.Printf("warning: unable to clean export workspace %s: %v", workingRoot, err)
	}

	submission.ExportBundlePath = zipPath
	submission.ExportBundleReady = true

	return nil
}

func buildEvaluationSummary(sub models.Submission, assets *evaluationAssets) string {
	var builder strings.Builder

	writeLine := func(format string, args ...any) {
		builder.WriteString(fmt.Sprintf(format, args...))
		builder.WriteByte('\n')
	}

	writeLine("Submission title: %s", fallbackString(sub.Title, "(unnamed submission)"))
	writeLine("Original file: %s", fallbackString(sub.FileName, "unknown"))
	if assets != nil {
		if assets.Assessment.Title != "" {
			writeLine("Assessment: %s", assets.Assessment.Title)
		}
		if assets.Subject != "" {
			writeLine("Configured subject: %s", assets.Subject)
		}
	}
	if sub.Subject != "" && (assets == nil || assets.Subject == "") {
		writeLine("Subject: %s", sub.Subject)
	}
	if sub.Grade != "" {
		writeLine("Grade / Cohort: %s", sub.Grade)
	}
	if ctxLabel := capitalizeFirst(sub.CohortType); ctxLabel != "" {
		writeLine("Education context: %s", ctxLabel)
	}
	writeLine("Evaluated on: %s", sub.CreatedAt.Format(time.RFC1123))
	writeLine("")
	writeLine("Score: %s / %s", formatFloat(sub.Score), formatFloat(sub.MaxScore))
	if sub.AlignmentWarning != "" {
		writeLine("Alignment warning: %s", strings.TrimSpace(sub.AlignmentWarning))
	}

	reasoning := strings.TrimSpace(sub.Reasoning)
	if reasoning != "" {
		writeLine("")
		writeLine("Overall feedback:")
		builder.WriteString(reasoning)
		builder.WriteString("\n")
	}

	deductions := extractDeductions(sub.Breakdown)
	if len(deductions) > 0 {
		writeLine("")
		writeLine("Why marks were deducted:")
		for _, item := range deductions {
			reason := strings.TrimSpace(item.Reason)
			if reason == "" {
				reason = "No reason provided"
			}
			writeLine(
				"- Question %s: awarded %s out of %s. %s",
				fallbackString(item.QuestionNumber, "(unknown)"),
				formatFloat(item.Score),
				formatFloat(item.MaxScore),
				reason,
			)
		}
	}

	if len(sub.Breakdown) > 0 {
		writeLine("")
		writeLine("Detailed breakdown:")
		sorted := append([]models.QuestionBreakdown(nil), sub.Breakdown...)
		sort.Slice(sorted, func(i, j int) bool {
			return strings.Compare(sorted[i].QuestionNumber, sorted[j].QuestionNumber) < 0
		})
		for _, item := range sorted {
			reason := strings.TrimSpace(item.Reason)
			if reason == "" {
				reason = "No reason provided"
			}
			writeLine(
				"- Q%s: %s / %s — %s",
				fallbackString(item.QuestionNumber, "?"),
				formatFloat(item.Score),
				formatFloat(item.MaxScore),
				reason,
			)
		}
	}

	if strings.TrimSpace(sub.Transcript) != "" {
		writeLine("")
		writeLine("Transcript saved separately as transcript.txt")
	}

	writeLine("")
	writeLine("Bundle generated on %s", time.Now().UTC().Format(time.RFC1123))

	return strings.TrimSpace(builder.String()) + "\n"
}

func buildBreakdownCSV(items []models.QuestionBreakdown) string {
	if len(items) == 0 {
		return "Question,Score,Max,Reason\n"
	}
	sorted := append([]models.QuestionBreakdown(nil), items...)
	sort.Slice(sorted, func(i, j int) bool {
		return strings.Compare(sorted[i].QuestionNumber, sorted[j].QuestionNumber) < 0
	})

	var builder strings.Builder
	builder.WriteString("Question,Score,Max,Reason\n")
	for _, item := range sorted {
		builder.WriteString(fmt.Sprintf(
			"%s,%s,%s,%s\n",
			csvEscape(fallbackString(item.QuestionNumber, "")),
			formatFloat(item.Score),
			formatFloat(item.MaxScore),
			csvEscape(strings.TrimSpace(item.Reason)),
		))
	}
	return builder.String()
}

func buildEvaluationHTML(sub models.Submission, assets *evaluationAssets, originalFileName string) string {
	title := fallbackString(sub.Title, sub.FileName)
	if title == "" {
		title = "Graded submission"
	}
	escapedTitle := html.EscapeString(title)
	escapedAssessment := ""
	if assets != nil && assets.Assessment.Title != "" {
		escapedAssessment = html.EscapeString(assets.Assessment.Title)
	}
	contextLabel := capitalizeFirst(sub.CohortType)
	var builder strings.Builder

	builder.WriteString("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"/>")
	builder.WriteString("<title>")
	builder.WriteString(escapedTitle)
	builder.WriteString(" – Evaluation Report</title>")
	builder.WriteString(`<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:2rem;background:#f8fafc;color:#0f172a;}
.container{max-width:960px;margin:0 auto;background:#ffffff;border-radius:18px;padding:2.5rem;box-shadow:0 20px 45px -32px rgba(15,23,42,0.45);}h1{margin-top:0;font-size:2rem;}h2{margin-top:2rem;font-size:1.4rem;color:#1f2937;}section+section{margin-top:1.75rem;}table{border-collapse:collapse;width:100%;margin-top:1rem;}th,td{border:1px solid #e2e8f0;padding:0.75rem 1rem;text-align:left;font-size:0.95rem;}th{background:#f1f5f9;text-transform:uppercase;font-size:0.8rem;letter-spacing:.08em;color:#475569;}tbody tr:nth-child(even){background:#f8fafc;}details{background:#f1f5f9;border-radius:12px;padding:1rem 1.25rem;}details summary{font-weight:600;cursor:pointer;}ul{padding-left:1.25rem;}a.button{display:inline-block;margin-top:1rem;padding:0.65rem 1.25rem;border-radius:999px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600;}
.meta{display:flex;flex-wrap:wrap;gap:0.75rem;margin-top:0.75rem;color:#475569;}
.tag{display:inline-flex;align-items:center;border-radius:999px;background:#eef2ff;border:1px solid #c7d2fe;color:#4338ca;padding:0.35rem 0.9rem;font-size:0.85rem;font-weight:600;}
.score{display:flex;align-items:baseline;gap:0.5rem;margin-top:1rem;font-size:1.5rem;font-weight:700;}
.score span{font-size:1rem;font-weight:600;color:#475569;}
.deductions ul{margin:0.5rem 0 0;}
.deductions li{margin-bottom:0.4rem;}
pre{background:#0f172a;color:#e2e8f0;border-radius:12px;padding:1rem;white-space:pre-wrap;word-break:break-word;}
</style></head><body><div class="container">`)

	builder.WriteString("<header><h1>")
	builder.WriteString(escapedTitle)
	builder.WriteString("</h1>")
	builder.WriteString("<div class=\"meta\">")
	if escapedAssessment != "" {
		builder.WriteString("<span class=\"tag\">Assessment: ")
		builder.WriteString(escapedAssessment)
		builder.WriteString("</span>")
	}
	if assets != nil && assets.Subject != "" {
		builder.WriteString("<span class=\"tag\">Subject: ")
		builder.WriteString(html.EscapeString(assets.Subject))
		builder.WriteString("</span>")
	} else if sub.Subject != "" {
		builder.WriteString("<span class=\"tag\">Subject: ")
		builder.WriteString(html.EscapeString(sub.Subject))
		builder.WriteString("</span>")
	}
	if sub.Grade != "" {
		builder.WriteString("<span class=\"tag\">Grade: ")
		builder.WriteString(html.EscapeString(sub.Grade))
		builder.WriteString("</span>")
	}
	if contextLabel != "" {
		builder.WriteString("<span class=\"tag\">Context: ")
		builder.WriteString(html.EscapeString(contextLabel))
		builder.WriteString("</span>")
	}
	builder.WriteString("<span class=\"tag\">Evaluated: ")
	builder.WriteString(html.EscapeString(sub.CreatedAt.Format(time.RFC1123)))
	builder.WriteString("</span></div>")
	builder.WriteString("<div class=\"score\">")
	builder.WriteString(html.EscapeString(formatFloat(sub.Score)))
	builder.WriteString("<span>/ ")
	builder.WriteString(html.EscapeString(formatFloat(sub.MaxScore)))
	builder.WriteString(" total marks</span></div>")
	if sub.AlignmentWarning != "" {
		builder.WriteString("<p class=\"tag\" style=\"background:#fef3c7;border-color:#fcd34d;color:#92400e;\">")
		builder.WriteString(html.EscapeString(strings.TrimSpace(sub.AlignmentWarning)))
		builder.WriteString("</p>")
	}
	if originalFileName != "" {
		builder.WriteString("<a class=\"button\" href=\"")
		builder.WriteString(html.EscapeString(originalFileName))
		builder.WriteString("\" download>Open original answer script</a>")
	}
	builder.WriteString("</header>")

	if strings.TrimSpace(sub.Reasoning) != "" {
		builder.WriteString("<section><h2>Overall Feedback</h2><p>")
		builder.WriteString(html.EscapeString(strings.TrimSpace(sub.Reasoning)))
		builder.WriteString("</p></section>")
	}

	breakdown := append([]models.QuestionBreakdown(nil), sub.Breakdown...)
	if len(breakdown) > 0 {
		sort.Slice(breakdown, func(i, j int) bool {
			return strings.Compare(breakdown[i].QuestionNumber, breakdown[j].QuestionNumber) < 0
		})
		builder.WriteString("<section><h2>Question Breakdown</h2><table><thead><tr><th>Question</th><th>Score</th><th>Max</th><th>Notes</th></tr></thead><tbody>")
		for _, item := range breakdown {
			builder.WriteString("<tr><td>")
			builder.WriteString(html.EscapeString(fallbackString(item.QuestionNumber, "-")))
			builder.WriteString("</td><td>")
			builder.WriteString(html.EscapeString(formatFloat(item.Score)))
			builder.WriteString("</td><td>")
			builder.WriteString(html.EscapeString(formatFloat(item.MaxScore)))
			builder.WriteString("</td><td>")
			builder.WriteString(html.EscapeString(strings.TrimSpace(item.Reason)))
			builder.WriteString("</td></tr>")
		}
		builder.WriteString("</tbody></table></section>")
	}

	deductions := extractDeductions(sub.Breakdown)
	if len(deductions) > 0 {
		builder.WriteString("<section class=\"deductions\"><h2>Why marks were deducted</h2><ul>")
		for _, item := range deductions {
			builder.WriteString("<li><strong>Question ")
			builder.WriteString(html.EscapeString(fallbackString(item.QuestionNumber, "-")))
			builder.WriteString(":</strong> awarded ")
			builder.WriteString(html.EscapeString(formatFloat(item.Score)))
			builder.WriteString(" of ")
			builder.WriteString(html.EscapeString(formatFloat(item.MaxScore)))
			builder.WriteString(" – ")
			builder.WriteString(html.EscapeString(strings.TrimSpace(item.Reason)))
			builder.WriteString("</li>")
		}
		builder.WriteString("</ul></section>")
	}

	if strings.TrimSpace(sub.Transcript) != "" {
		builder.WriteString("<section><h2>Extracted Transcript</h2><details open><summary>View student response</summary><pre>")
		builder.WriteString(html.EscapeString(sub.Transcript))
		builder.WriteString("</pre></details></section>")
	}

	builder.WriteString("<footer><p>Report generated on ")
	builder.WriteString(html.EscapeString(time.Now().UTC().Format(time.RFC1123)))
	builder.WriteString(".</p></footer></div></body></html>")

	return builder.String()
}

func extractDeductions(items []models.QuestionBreakdown) []models.QuestionBreakdown {
	result := make([]models.QuestionBreakdown, 0)
	for _, item := range items {
		if item.MaxScore > 0 && item.Score < item.MaxScore {
			result = append(result, item)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return strings.Compare(result[i].QuestionNumber, result[j].QuestionNumber) < 0
	})
	return result
}

func csvEscape(value string) string {
	escaped := strings.ReplaceAll(value, "\"", "\"\"")
	return "\"" + escaped + "\""
}

func formatFloat(value float64) string {
	return fmt.Sprintf("%.2f", value)
}

func fallbackString(value, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback
	}
	return trimmed
}

func capitalizeFirst(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	runes := []rune(trimmed)
	runes[0] = unicode.ToUpper(runes[0])
	return string(runes)
}

func sanitizeFileNamePreserveExt(name string) string {
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	sanitizedBase := sanitizeFileName(base)
	if sanitizedBase == "" {
		sanitizedBase = "submission"
	}
	cleanExt := sanitizeFileName(strings.TrimPrefix(ext, "."))
	if cleanExt == "" {
		if ext == "" {
			return sanitizedBase
		}
		return sanitizedBase + ext
	}
	return sanitizedBase + "." + cleanExt
}

func copyFile(src, dst string) error {
	input, err := os.Open(src)
	if err != nil {
		return err
	}
	defer input.Close()

	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}

	output, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(output, input); err != nil {
		output.Close()
		return err
	}
	return output.Close()
}

func createZipFromFolder(zipPath, baseDir, folderPath string) error {
	if err := os.MkdirAll(filepath.Dir(zipPath), 0o755); err != nil {
		return err
	}
	if err := os.Remove(zipPath); err != nil && !os.IsNotExist(err) {
		return err
	}

	zipFile, err := os.Create(zipPath)
	if err != nil {
		return err
	}
	writer := zip.NewWriter(zipFile)

	err = filepath.WalkDir(folderPath, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(baseDir, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if d.IsDir() {
			if rel == "." {
				return nil
			}
			_, err = writer.Create(rel + "/")
			return err
		}
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		entry, err := writer.Create(rel)
		if err != nil {
			file.Close()
			return err
		}
		if _, err := io.Copy(entry, file); err != nil {
			file.Close()
			return err
		}
		return file.Close()
	})
	if err != nil {
		writer.Close()
		zipFile.Close()
		_ = os.Remove(zipPath)
		return err
	}

	if err := writer.Close(); err != nil {
		zipFile.Close()
		_ = os.Remove(zipPath)
		return err
	}
	if err := zipFile.Close(); err != nil {
		_ = os.Remove(zipPath)
		return err
	}
	return nil
}

func (h *SubmissionHandler) generateBulkBundle(uploadsDir, batchLabel string, submissions []models.Submission) (string, error) {
	if len(submissions) == 0 {
		return "", errors.New("no submissions to bundle")
	}

	label := strings.TrimSpace(batchLabel)
	if label == "" {
		label = submissions[0].Title
	}
	if label == "" {
		label = "Batch"
	}
	slug := sanitizeFileName(label)
	if slug == "" {
		slug = fmt.Sprintf("batch-%d", time.Now().Unix())
	}

	batchRoot := filepath.Join(uploadsDir, "exports", "batches", fmt.Sprintf("%s-%d", slug, time.Now().Unix()))
	if err := os.MkdirAll(batchRoot, 0o755); err != nil {
		return "", err
	}
	defer func() {
		if _, err := os.Stat(batchRoot); err == nil {
			if remErr := os.RemoveAll(batchRoot); remErr != nil {
				log.Printf("warning: unable to clean batch workspace %s: %v", batchRoot, remErr)
			}
		}
	}()

	rows := make([]batchSummaryRow, 0, len(submissions))
	sumScore := 0.0
	sumMax := 0.0

	for _, sub := range submissions {
		if !sub.ExportBundleReady || sub.ExportBundlePath == "" {
			continue
		}
		if _, err := os.Stat(sub.ExportBundlePath); err != nil {
			log.Printf("warning: skipping submission %s for batch export: %v", sub.ID.Hex(), err)
			continue
		}

		subSlug := sanitizeFileName(fallbackString(sub.Title, sub.FileName))
		if subSlug == "" {
			subSlug = fmt.Sprintf("submission-%s", sub.ID.Hex()[:6])
		}
		subFolder := fmt.Sprintf("%s-%s", subSlug, sub.ID.Hex()[:6])
		targetDir := filepath.Join(batchRoot, "submissions", subFolder)
		if err := extractZipToFolder(sub.ExportBundlePath, targetDir); err != nil {
			log.Printf("warning: unable to extract bundle for submission %s: %v", sub.ID.Hex(), err)
			continue
		}
		relPath := filepath.ToSlash(filepath.Join("submissions", subFolder, "index.html"))
		rows = append(rows, batchSummaryRow{
			Title:        fallbackString(sub.Title, sub.FileName),
			FileName:     sub.FileName,
			Score:        sub.Score,
			MaxScore:     sub.MaxScore,
			RelativePath: relPath,
		})
		sumScore += sub.Score
		sumMax += sub.MaxScore
	}

	if len(rows) == 0 {
		return "", errors.New("no bundles to include in batch export")
	}

	if err := os.WriteFile(filepath.Join(batchRoot, "index.html"), []byte(buildBatchHTML(label, rows, sumScore, sumMax)), 0o644); err != nil {
		return "", err
	}

	batchJSON := map[string]any{
		"batch":       label,
		"generatedAt": time.Now().UTC().Format(time.RFC3339),
		"totalScore":  sumScore,
		"totalMax":    sumMax,
		"submissions": rows,
	}
	jsonBytes, err := json.MarshalIndent(batchJSON, "", "  ")
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(batchRoot, "overview.json"), jsonBytes, 0o644); err != nil {
		return "", err
	}

	zipName := fmt.Sprintf("%s-batch-%d.zip", slug, time.Now().Unix())
	zipPath := filepath.Join(uploadsDir, "exports", "batches", zipName)
	if err := createZipFromFolder(zipPath, filepath.Dir(batchRoot), batchRoot); err != nil {
		return "", err
	}

	return zipName, nil
}

func (h *SubmissionHandler) tryGenerateBatchBundle(uploadsDir, titlePrefix, titleOverride string, submissions []models.Submission) string {
	if len(submissions) == 0 {
		return ""
	}

	label := strings.TrimSpace(titlePrefix)
	if label == "" {
		label = strings.TrimSpace(titleOverride)
	}
	if label == "" {
		label = submissions[0].Title
	}
	if label == "" {
		label = "Batch"
	}

	zipName, err := h.generateBulkBundle(uploadsDir, label, submissions)
	if err != nil {
		log.Printf("warning: unable to create batch export bundle: %v", err)
		return ""
	}
	return fmt.Sprintf("/api/submissions/bulk/export/%s", zipName)
}

func buildBatchHTML(batchLabel string, rows []batchSummaryRow, totalScore, totalMax float64) string {
	safeLabel := html.EscapeString(batchLabel)
	var builder strings.Builder

	builder.WriteString("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"/>")
	builder.WriteString("<title>")
	builder.WriteString(safeLabel)
	builder.WriteString(" – Batch Report</title>")
	builder.WriteString(`<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:2rem;background:#f8fafc;color:#0f172a;}
.container{max-width:1100px;margin:0 auto;background:#ffffff;border-radius:18px;padding:2.5rem;box-shadow:0 20px 45px -32px rgba(15,23,42,0.45);}h1{margin-top:0;font-size:2rem;}table{width:100%;border-collapse:collapse;margin-top:2rem;}th,td{border:1px solid #e2e8f0;padding:0.85rem 1rem;text-align:left;}th{background:#f1f5f9;text-transform:uppercase;font-size:0.8rem;letter-spacing:.08em;color:#475569;}tbody tr:nth-child(even){background:#f8fafc;}a{color:#2563eb;text-decoration:none;font-weight:600;}a:hover{text-decoration:underline;}
.summary{display:flex;flex-wrap:wrap;gap:1rem;margin-top:1rem;font-size:1rem;color:#475569;} .summary span{border-radius:999px;background:#eef2ff;border:1px solid #c7d2fe;padding:0.45rem 0.9rem;font-weight:600;}
</style></head><body><div class="container">`)
	builder.WriteString("<h1>Batch: ")
	builder.WriteString(safeLabel)
	builder.WriteString("</h1>")
	builder.WriteString("<div class=\"summary\"><span>Total Score: ")
	builder.WriteString(html.EscapeString(formatFloat(totalScore)))
	builder.WriteString("</span><span>Total Max: ")
	builder.WriteString(html.EscapeString(formatFloat(totalMax)))
	builder.WriteString("</span><span>Evaluations: ")
	builder.WriteString(fmt.Sprintf("%d", len(rows)))
	builder.WriteString("</span></div>")
	builder.WriteString("<table><thead><tr><th>Submission</th><th>Original File</th><th>Score</th><th>Max</th><th>Report</th></tr></thead><tbody>")
	for _, row := range rows {
		builder.WriteString("<tr><td>")
		builder.WriteString(html.EscapeString(fallbackString(row.Title, row.FileName)))
		builder.WriteString("</td><td>")
		builder.WriteString(html.EscapeString(row.FileName))
		builder.WriteString("</td><td>")
		builder.WriteString(html.EscapeString(formatFloat(row.Score)))
		builder.WriteString("</td><td>")
		builder.WriteString(html.EscapeString(formatFloat(row.MaxScore)))
		builder.WriteString("</td><td><a href=\"")
		builder.WriteString(html.EscapeString(row.RelativePath))
		builder.WriteString("\">View details</a></td></tr>")
	}
	builder.WriteString("</tbody></table><p style=\"margin-top:2rem;color:#64748b;\">Each row links to the full evaluation bundle for that answer script.</p></div></body></html>")
	return builder.String()
}

func extractZipToFolder(zipPath, destDir string) error {
	reader, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer reader.Close()

	for _, file := range reader.File {
		name := filepath.ToSlash(file.Name)
		for strings.HasPrefix(name, "./") {
			name = strings.TrimPrefix(name, "./")
		}
		if idx := strings.Index(name, "/"); idx != -1 {
			name = name[idx+1:]
		}
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		target := filepath.Join(destDir, filepath.FromSlash(name))
		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		rc, err := file.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, file.Mode())
		if err != nil {
			rc.Close()
			return err
		}
		if _, err := io.Copy(out, rc); err != nil {
			rc.Close()
			out.Close()
			return err
		}
		rc.Close()
		if err := out.Close(); err != nil {
			return err
		}
	}

	return nil
}
