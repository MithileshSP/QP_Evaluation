package models

import (
    "time"

    "go.mongodb.org/mongo-driver/bson/primitive"
)

// AssetMeta tracks stored files for assessments.
type AssetMeta struct {
    FileName   string    `bson:"file_name" json:"fileName"`
    StoredPath string    `bson:"stored_path" json:"storedPath"`
    MimeType   string    `bson:"mime_type" json:"mimeType"`
    Size       int64     `bson:"size" json:"size"`
    UploadedAt time.Time `bson:"uploaded_at" json:"uploadedAt"`
}

// Assessment captures the reference materials used for evaluation.
type Assessment struct {
    ID            primitive.ObjectID `bson:"_id,omitempty" json:"id"`
    Slug          string             `bson:"slug" json:"slug"`
    Title         string             `bson:"title" json:"title"`
    Subject       string             `bson:"subject" json:"subject"`
    MaxScore      float64            `bson:"max_score" json:"maxScore"`
    QuestionPaper *AssetMeta         `bson:"question_paper,omitempty" json:"questionPaper,omitempty"`
    AnswerKey     *AssetMeta         `bson:"answer_key,omitempty" json:"answerKey,omitempty"`
    CreatedAt     time.Time          `bson:"created_at" json:"createdAt"`
    UpdatedAt     time.Time          `bson:"updated_at" json:"updatedAt"`
}
