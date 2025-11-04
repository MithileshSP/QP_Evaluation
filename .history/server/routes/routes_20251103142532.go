package routes

import (
    "github.com/gin-contrib/cors"
    "github.com/gin-gonic/gin"

    "github.com/example/clg-qps/server/handlers"
    "github.com/example/clg-qps/server/middlewares"
)

// Register mounts all HTTP routes on the provided router.
func Register(r *gin.Engine, auth *handlers.AuthHandler, prompt *handlers.PromptHandler, submissions *handlers.SubmissionHandler) {
    r.Use(cors.New(cors.Config{
        AllowOrigins:     []string{"*"},
        AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
        AllowHeaders:     []string{"Authorization", "Content-Type"},
        AllowCredentials: true,
    }))

    api := r.Group("/api")

    authGroup := api.Group("/auth")
    {
        authGroup.POST("/register", auth.Register)
        authGroup.POST("/login", auth.Login)
    }

    protected := api.Group("")
    protected.Use(middlewares.AuthRequired())

    protected.GET("/prompt", prompt.GetPrompt)
    protected.PUT("/prompt", middlewares.RequireRole("admin"), prompt.UpdatePrompt)

    protected.POST("/submissions", middlewares.RequireRole("admin", "user"), submissions.UploadSubmission)
    protected.GET("/submissions", middlewares.RequireRole("admin", "user"), submissions.ListSubmissions)
}
