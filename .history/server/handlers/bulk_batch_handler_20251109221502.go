package handlers

import (
	"context"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/example/clg-qps/server/models"
)

type BulkBatchHandler struct {
	bulkBatchCollection  *mongo.Collection
	submissionCollection *mongo.Collection
}

func NewBulkBatchHandler(db *mongo.Database) *BulkBatchHandler {
	return &BulkBatchHandler{
		bulkBatchCollection:  db.Collection("bulk_batches"),
		submissionCollection: db.Collection("submissions"),
	}
}

// CreateBulkBatch creates a new bulk batch record
func (h *BulkBatchHandler) CreateBulkBatch(c *gin.Context) {
	var req struct {
		Title         string   `json:"title" binding:"required"`
		Description   string   `json:"description"`
		BundleURL     string   `json:"bundleUrl"`
		AssessmentID  string   `json:"assessmentId"`
		SubmissionIDs []string `json:"submissionIds" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request payload", "details": err.Error()})
		return
	}

	// Convert submission IDs from string to ObjectID
	submissionIDs := make([]primitive.ObjectID, 0, len(req.SubmissionIDs))
	for _, idStr := range req.SubmissionIDs {
		objID, err := primitive.ObjectIDFromHex(idStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid submission ID format", "id": idStr})
			return
		}
		submissionIDs = append(submissionIDs, objID)
	}

	// Convert assessment ID if provided
	var assessmentID primitive.ObjectID
	if req.AssessmentID != "" {
		var err error
		assessmentID, err = primitive.ObjectIDFromHex(req.AssessmentID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid assessment ID format"})
			return
		}
	}

	batch := models.BulkBatch{
		Title:         req.Title,
		Description:   req.Description,
		BundleURL:     req.BundleURL,
		AssessmentID:  assessmentID,
		SubmissionIDs: submissionIDs,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	result, err := h.bulkBatchCollection.InsertOne(ctx, batch)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create bulk batch", "details": err.Error()})
		return
	}

	batch.ID = result.InsertedID.(primitive.ObjectID)

	// Fetch the submissions to include in response
	submissions, err := h.fetchSubmissionsByIDs(ctx, submissionIDs)
	if err == nil {
		batch.Submissions = submissions
	}

	c.JSON(http.StatusCreated, batch)
}

// GetAllBulkBatches retrieves all bulk batches with their submissions
func (h *BulkBatchHandler) GetAllBulkBatches(c *gin.Context) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Sort by creation date, newest first
	opts := options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}})

	cursor, err := h.bulkBatchCollection.Find(ctx, bson.M{}, opts)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch bulk batches", "details": err.Error()})
		return
	}
	defer cursor.Close(ctx)

	var batches []models.BulkBatch
	if err := cursor.All(ctx, &batches); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to decode bulk batches", "details": err.Error()})
		return
	}

	// Populate submissions for each batch
	for i := range batches {
		submissions, err := h.fetchSubmissionsByIDs(ctx, batches[i].SubmissionIDs)
		if err == nil {
			batches[i].Submissions = submissions
		}
	}

	c.JSON(http.StatusOK, batches)
}

// GetBulkBatch retrieves a single bulk batch by ID
func (h *BulkBatchHandler) GetBulkBatch(c *gin.Context) {
	idParam := c.Param("id")
	objID, err := primitive.ObjectIDFromHex(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid bulk batch ID format"})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var batch models.BulkBatch
	err = h.bulkBatchCollection.FindOne(ctx, bson.M{"_id": objID}).Decode(&batch)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			c.JSON(http.StatusNotFound, gin.H{"error": "Bulk batch not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch bulk batch", "details": err.Error()})
		return
	}

	// Populate submissions
	submissions, err := h.fetchSubmissionsByIDs(ctx, batch.SubmissionIDs)
	if err == nil {
		batch.Submissions = submissions
	}

	c.JSON(http.StatusOK, batch)
}

// DeleteBulkBatch deletes a bulk batch by ID
func (h *BulkBatchHandler) DeleteBulkBatch(c *gin.Context) {
	idParam := c.Param("id")
	objID, err := primitive.ObjectIDFromHex(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid bulk batch ID format"})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	result, err := h.bulkBatchCollection.DeleteOne(ctx, bson.M{"_id": objID})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete bulk batch", "details": err.Error()})
		return
	}

	if result.DeletedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Bulk batch not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Bulk batch deleted successfully"})
}

// Helper function to fetch submissions by IDs
func (h *BulkBatchHandler) fetchSubmissionsByIDs(ctx context.Context, ids []primitive.ObjectID) ([]models.Submission, error) {
	if len(ids) == 0 {
		return []models.Submission{}, nil
	}

	cursor, err := h.submissionCollection.Find(ctx, bson.M{"_id": bson.M{"$in": ids}})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var submissions []models.Submission
	if err := cursor.All(ctx, &submissions); err != nil {
		return nil, err
	}

	// Sort submissions to match the order of IDs
	submissionMap := make(map[primitive.ObjectID]models.Submission)
	for _, sub := range submissions {
		submissionMap[sub.ID] = sub
	}

	sortedSubmissions := make([]models.Submission, 0, len(ids))
	for _, id := range ids {
		if sub, ok := submissionMap[id]; ok {
			sortedSubmissions = append(sortedSubmissions, sub)
		}
	}

	return sortedSubmissions, nil
}

// GetGroupedSubmissions groups submissions by title prefix and returns them as virtual bulk batches
func (h *BulkBatchHandler) GetGroupedSubmissions(c *gin.Context) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Fetch all submissions sorted by creation date
	opts := options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}})
	cursor, err := h.submissionCollection.Find(ctx, bson.M{}, opts)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch submissions", "details": err.Error()})
		return
	}
	defer cursor.Close(ctx)

	var submissions []models.Submission
	if err := cursor.All(ctx, &submissions); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to decode submissions", "details": err.Error()})
		return
	}

	// Fetch existing bulk batches
	batchCursor, err := h.bulkBatchCollection.Find(ctx, bson.M{}, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch bulk batches", "details": err.Error()})
		return
	}
	defer batchCursor.Close(ctx)

	var existingBatches []models.BulkBatch
	if err := batchCursor.All(ctx, &existingBatches); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to decode bulk batches", "details": err.Error()})
		return
	}

	// Track which submissions are already in existing batches
	inBatchMap := make(map[primitive.ObjectID]bool)
	for _, batch := range existingBatches {
		for _, subID := range batch.SubmissionIDs {
			inBatchMap[subID] = true
		}
	}

	// Populate submissions for existing batches
	for i := range existingBatches {
		subs, err := h.fetchSubmissionsByIDs(ctx, existingBatches[i].SubmissionIDs)
		if err == nil {
			existingBatches[i].Submissions = subs
		}
	}

	// Group remaining submissions by title prefix
	type GroupInfo struct {
		Prefix      string
		Submissions []models.Submission
		CreatedAt   time.Time
	}
	groups := make(map[string]*GroupInfo)

	for _, sub := range submissions {
		// Skip if already in a batch
		if inBatchMap[sub.ID] {
			continue
		}

		prefix := extractTitlePrefix(sub.Title)
		if prefix == "" {
			continue // Skip submissions without clear prefix
		}

		if _, exists := groups[prefix]; !exists {
			groups[prefix] = &GroupInfo{
				Prefix:      prefix,
				Submissions: []models.Submission{},
				CreatedAt:   sub.CreatedAt,
			}
		}
		groups[prefix].Submissions = append(groups[prefix].Submissions, sub)
		// Use the oldest (last) submission's creation time
		if sub.CreatedAt.Before(groups[prefix].CreatedAt) {
			groups[prefix].CreatedAt = sub.CreatedAt
		}
	}

	// Convert groups to virtual bulk batches (only if group has 2+ submissions)
	virtualBatches := make([]models.BulkBatch, 0)
	for prefix, group := range groups {
		if len(group.Submissions) >= 2 {
			submissionIDs := make([]primitive.ObjectID, len(group.Submissions))
			for i, sub := range group.Submissions {
				submissionIDs[i] = sub.ID
			}

			virtualBatch := models.BulkBatch{
				ID:            primitive.NewObjectID(), // Virtual ID
				Title:         prefix,
				Description:   "Auto-grouped submissions with common title prefix",
				SubmissionIDs: submissionIDs,
				Submissions:   group.Submissions,
				CreatedAt:     group.CreatedAt,
				UpdatedAt:     group.CreatedAt,
			}
			virtualBatches = append(virtualBatches, virtualBatch)
		}
	}

	// Combine existing batches and virtual batches
	allBatches := append(existingBatches, virtualBatches...)

	// Sort all batches by creation date
	// (already sorted from database query for existing, virtual batches added after)

	c.JSON(http.StatusOK, allBatches)
}

// extractTitlePrefix extracts common prefix from submission title
// Examples: "Aadhi 01" -> "Aadhi", "Sec 02" -> "Sec"
func extractTitlePrefix(title string) string {
	title = strings.TrimSpace(title)
	if title == "" {
		return ""
	}

	// Pattern: "Word Number" -> extract "Word"
	re := regexp.MustCompile(`^([A-Za-z]+)\s+\d+`)
	matches := re.FindStringSubmatch(title)
	if len(matches) > 1 {
		return matches[1]
	}

	// Pattern: "Word_Number" or "Word-Number" -> extract "Word"
	re2 := regexp.MustCompile(`^([A-Za-z]+)[_\-]\d+`)
	matches2 := re2.FindStringSubmatch(title)
	if len(matches2) > 1 {
		return matches2[1]
	}

	return ""
}
