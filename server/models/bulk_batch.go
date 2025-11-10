package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// BulkBatch represents a batch of submissions evaluated together
type BulkBatch struct {
	ID            primitive.ObjectID   `bson:"_id,omitempty" json:"id"`
	Title         string               `bson:"title" json:"title"`
	Description   string               `bson:"description" json:"description"`
	BundleURL     string               `bson:"bundle_url,omitempty" json:"bundleUrl,omitempty"`
	AssessmentID  primitive.ObjectID   `bson:"assessment_id,omitempty" json:"assessmentId,omitempty"`
	SubmissionIDs []primitive.ObjectID `bson:"submission_ids" json:"submissionIds"`
	Submissions   []Submission         `bson:"-" json:"submissions,omitempty"` // Populated on fetch
	CreatedAt     time.Time            `bson:"created_at" json:"createdAt"`
	UpdatedAt     time.Time            `bson:"updated_at" json:"updatedAt"`
}
