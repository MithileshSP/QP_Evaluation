package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// Submission captures a learner upload and the AI-generated evaluation.
type Submission struct {
	ID               primitive.ObjectID  `bson:"_id,omitempty" json:"id"`
	Title            string              `bson:"title,omitempty" json:"title,omitempty"`
	Subject          string              `bson:"subject,omitempty" json:"subject,omitempty"`
	AssessmentID     primitive.ObjectID  `bson:"assessment_id,omitempty" json:"assessmentId,omitempty"`
	FileName         string              `bson:"file_name" json:"fileName"`
	StoredPath       string              `bson:"stored_path" json:"storedPath"`
	MimeType         string              `bson:"mime_type" json:"mimeType"`
	Score            float64             `bson:"score" json:"score"`
	MaxScore         float64             `bson:"max_score" json:"maxScore"`
	Reasoning        string              `bson:"reasoning" json:"reasoning"`
	Breakdown        []QuestionBreakdown `bson:"breakdown,omitempty" json:"breakdown,omitempty"`
	Transcript       string              `bson:"transcript,omitempty" json:"transcript,omitempty"`
	AlignmentWarning string              `bson:"alignment_warning,omitempty" json:"alignmentWarning,omitempty"`
	RubricUsed       string              `bson:"rubric_used" json:"rubricUsed"`
	CreatedAt        time.Time           `bson:"created_at" json:"createdAt"`
}

// QuestionBreakdown stores per-question evaluation details returned by the AI.
type QuestionBreakdown struct {
	QuestionNumber string  `bson:"question_number" json:"questionNumber"`
	Score          float64 `bson:"score" json:"score"`
	MaxScore       float64 `bson:"max_score" json:"maxScore"`
	Reason         string  `bson:"reason" json:"reason"`
}
