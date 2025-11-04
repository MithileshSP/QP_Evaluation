package models

import (
    "time"

    "go.mongodb.org/mongo-driver/bson/primitive"
)

// UserRole represents the application roles supported by the system.
type UserRole string

const (
    // RoleAdmin is allowed to manage evaluation prompts and view all submissions.
    RoleAdmin UserRole = "admin"
    // RoleUser can upload submissions and review their own feedback.
    RoleUser  UserRole = "user"
)

// User represents an application user stored in MongoDB.
type User struct {
    ID           primitive.ObjectID `bson:"_id,omitempty" json:"id"`
    Username     string             `bson:"username" json:"username"`
    PasswordHash string             `bson:"password_hash" json:"-"`
    Role         UserRole           `bson:"role" json:"role"`
    CreatedAt    time.Time          `bson:"created_at" json:"createdAt"`
}
