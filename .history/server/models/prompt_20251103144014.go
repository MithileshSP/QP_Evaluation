package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// Prompt holds the configurable grading instructions maintained by admins.
type Prompt struct {
	ID           primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	Slug        string             `bson:"slug" json:"slug"`
	Title        string             `bson:"title" json:"title"`
	SystemPrompt string             `bson:"system_prompt" json:"systemPrompt"`
	UpdatedBy    primitive.ObjectID `bson:"updated_by" json:"updatedBy"`
	UpdatedAt    time.Time          `bson:"updated_at" json:"updatedAt"`
}
