package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// Submission captures a learner upload and the AI-generated evaluation.
type Submission struct {
	ID         primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	Title      string             `bson:"title,omitempty" json:"title,omitempty"`
	FileName   string             `bson:"file_name" json:"fileName"`
	StoredPath string             `bson:"stored_path" json:"storedPath"`
	MimeType   string             `bson:"mime_type" json:"mimeType"`
	Score      float64            `bson:"score" json:"score"`
	MaxScore   float64            `bson:"max_score" json:"maxScore"`
	Reasoning  string             `bson:"reasoning" json:"reasoning"`
	RubricUsed string             `bson:"rubric_used" json:"rubricUsed"`
	CreatedAt  time.Time          `bson:"created_at" json:"createdAt"`
}
