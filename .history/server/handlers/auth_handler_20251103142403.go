package handlers

import (
    "context"
    "errors"
    "net/http"
    "os"
    "strings"
    "time"

    "github.com/gin-gonic/gin"
    "golang.org/x/crypto/bcrypt"
    "go.mongodb.org/mongo-driver/bson"
    "go.mongodb.org/mongo-driver/bson/primitive"
    "go.mongodb.org/mongo-driver/mongo"
    "go.mongodb.org/mongo-driver/mongo/options"

    "github.com/example/clg-qps/server/models"
    "github.com/example/clg-qps/server/utils"
)

// AuthHandler orchestrates authentication endpoints.
type AuthHandler struct {
    users     *mongo.Collection
    adminCode string
}

// NewAuthHandler returns an initialized AuthHandler.
func NewAuthHandler(db *mongo.Database) *AuthHandler {
    collection := db.Collection("users")
    ensureUserIndexes(collection)
    return &AuthHandler{
        users:     collection,
        adminCode: os.Getenv("ADMIN_REGISTRATION_CODE"),
    }
}

// ensureUserIndexes enforces unique constraints we rely on.
func ensureUserIndexes(col *mongo.Collection) {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()

    indexModel := mongo.IndexModel{
        Keys:    bson.D{{Key: "username", Value: 1}},
        Options: options.Index().SetUnique(true).SetName("unique_username"),
    }
    if _, err := col.Indexes().CreateOne(ctx, indexModel); err != nil {
        // We intentionally log only; if the index exists already, Mongo raises an error.
        // Using Printf avoids importing log to keep output terse.
        //nolint:forbidigo // acceptable during init
        println("warning: unable to ensure username index:", err.Error())
    }
}

// RegisterRequest defines the expected payload for user registration.
type RegisterRequest struct {
    Username   string `json:"username" binding:"required,min=3"`
    Password   string `json:"password" binding:"required,min=6"`
    Role       string `json:"role"`
    AdminCode  string `json:"adminCode"`
}

// LoginRequest defines the expected payload for login.
type LoginRequest struct {
    Username string `json:"username" binding:"required"`
    Password string `json:"password" binding:"required"`
}

// AuthResponse is returned after successful login or registration.
type AuthResponse struct {
    Token    string `json:"token"`
    UserID   string `json:"userId"`
    Username string `json:"username"`
    Role     string `json:"role"`
}

// Register creates a new user account.
func (h *AuthHandler) Register(c *gin.Context) {
    var req RegisterRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }

    role := models.RoleUser
    if req.Role != "" {
        normalized := strings.ToLower(req.Role)
        switch normalized {
        case string(models.RoleAdmin):
            if h.adminCode == "" {
                c.JSON(http.StatusForbidden, gin.H{"error": "admin registration disabled"})
                return
            }
            if req.AdminCode == "" || req.AdminCode != h.adminCode {
                c.JSON(http.StatusForbidden, gin.H{"error": "invalid admin code"})
                return
            }
            role = models.RoleAdmin
        case string(models.RoleUser):
            role = models.RoleUser
        default:
            c.JSON(http.StatusBadRequest, gin.H{"error": "unknown role"})
            return
        }
    }

    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()

    hashed, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to hash password"})
        return
    }

    user := models.User{
        ID:           primitive.NewObjectID(),
        Username:     strings.ToLower(req.Username),
        PasswordHash: string(hashed),
        Role:         role,
        CreatedAt:    time.Now().UTC(),
    }

    if _, err := h.users.InsertOne(ctx, user); err != nil {
        if mongo.IsDuplicateKeyError(err) {
            c.JSON(http.StatusConflict, gin.H{"error": "username already exists"})
            return
        }
        c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to create user"})
        return
    }

    token, err := utils.GenerateToken(user.ID.Hex(), string(user.Role))
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to generate token"})
        return
    }

    c.JSON(http.StatusCreated, AuthResponse{
        Token:    token,
        UserID:   user.ID.Hex(),
        Username: user.Username,
        Role:     string(user.Role),
    })
}

// Login authenticates a user and issues a JWT.
func (h *AuthHandler) Login(c *gin.Context) {
    var req LoginRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }

    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()

    var user models.User
    err := h.users.FindOne(ctx, bson.M{"username": strings.ToLower(req.Username)}).Decode(&user)
    if err != nil {
        if errors.Is(err, mongo.ErrNoDocuments) {
            c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
            return
        }
        c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to fetch user"})
        return
    }

    if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)) != nil {
        c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
        return
    }

    token, err := utils.GenerateToken(user.ID.Hex(), string(user.Role))
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to generate token"})
        return
    }

    c.JSON(http.StatusOK, AuthResponse{
        Token:    token,
        UserID:   user.ID.Hex(),
        Username: user.Username,
        Role:     string(user.Role),
    })
}
