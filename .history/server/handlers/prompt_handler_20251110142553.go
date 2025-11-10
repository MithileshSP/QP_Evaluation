package handlers

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/example/clg-qps/server/models"
)

// PromptHandler allows admins to manage grading prompts.
type PromptHandler struct {
	prompts *mongo.Collection
}

// NewPromptHandler constructs a new PromptHandler instance.
func NewPromptHandler(db *mongo.Database) *PromptHandler {
	collection := db.Collection("prompts")
	ensurePromptIndexes(collection)
	return &PromptHandler{prompts: collection}
}

func ensurePromptIndexes(col *mongo.Collection) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	indexModel := mongo.IndexModel{
		Keys:    bson.D{{Key: "slug", Value: 1}},
		Options: options.Index().SetUnique(true).SetName("unique_slug"),
	}
	if _, err := col.Indexes().CreateOne(ctx, indexModel); err != nil {
		log.Printf("warning: unable to ensure prompt index: %v", err)
	}
}

// PromptUpdateRequest captures admin-provided grading instructions.
type PromptUpdateRequest struct {
	Title        string `json:"title"`
	SystemPrompt string `json:"systemPrompt" binding:"required"`
}

// PromptResponse is serialized to clients.
type PromptResponse struct {
	ID           string    `json:"id"`
	Slug         string    `json:"slug"`
	Title        string    `json:"title"`
	SystemPrompt string    `json:"systemPrompt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// GetPrompt returns the application grading prompt, creating a default if absent.
func (h *PromptHandler) GetPrompt(c *gin.Context) {
	prompt, err := h.ensureDefaultPrompt(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to load prompt"})
		return
	}

	c.JSON(http.StatusOK, modelToResponse(prompt))
}

// UpdatePrompt upserts the grading prompt.
func (h *PromptHandler) UpdatePrompt(c *gin.Context) {
	var req PromptUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	update := bson.M{
		"$set": bson.M{
			"title":         req.Title,
			"system_prompt": req.SystemPrompt,
			"updated_at":    time.Now().UTC(),
		},
	}

	opts := options.FindOneAndUpdate().SetUpsert(true).SetReturnDocument(options.After)
	var result models.Prompt
	if err := h.prompts.FindOneAndUpdate(ctx, bson.M{"slug": "default"}, update, opts).Decode(&result); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to update prompt"})
		return
	}

	c.JSON(http.StatusOK, modelToResponse(result))
}

func (h *PromptHandler) ensureDefaultPrompt(c *gin.Context) (models.Prompt, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var prompt models.Prompt
	err := h.prompts.FindOne(ctx, bson.M{"slug": "default"}).Decode(&prompt)
	if err == nil {
		return prompt, nil
	}
	if err != mongo.ErrNoDocuments {
		return models.Prompt{}, err
	}

	prompt = models.Prompt{
		ID:           primitive.NewObjectID(),
		Slug:         "default",
		Title:        "Default Grading Prompt",
		SystemPrompt: defaultPrompt(),
		UpdatedAt:    time.Now().UTC(),
	}

	if _, insertErr := h.prompts.InsertOne(ctx, bson.M{
		"_id":           prompt.ID,
		"slug":          prompt.Slug,
		"title":         prompt.Title,
		"system_prompt": prompt.SystemPrompt,
		"updated_at":    prompt.UpdatedAt,
	}); insertErr != nil {
		return models.Prompt{}, insertErr
	}
	return prompt, nil
}

func defaultPrompt() string {
	return "You are an experienced examiner. Analyse the provided answer script, award marks fairly, and honour the Total Marks value supplied in the constraints when reporting maxScore. Always respond with a JSON object containing score, maxScore, and reasoning."
}

func modelToResponse(prompt models.Prompt) PromptResponse {
	id := ""
	if !prompt.ID.IsZero() {
		id = prompt.ID.Hex()
	}
	return PromptResponse{
		ID:           id,
		Slug:         prompt.Slug,
		Title:        prompt.Title,
		SystemPrompt: prompt.SystemPrompt,
		UpdatedAt:    prompt.UpdatedAt,
	}
}
