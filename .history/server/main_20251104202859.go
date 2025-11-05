package main

import (
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"

	"github.com/example/clg-qps/server/database"
	"github.com/example/clg-qps/server/handlers"
	"github.com/example/clg-qps/server/routes"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Printf("warning: unable to load .env file: %v", err)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
	}

	db := database.GetDatabase()

	promptHandler := handlers.NewPromptHandler(db)
	submissionHandler := handlers.NewSubmissionHandler(db)
 	assessmentHandler := handlers.NewAssessmentHandler(db)

	router := gin.Default()
	routes.Register(router, promptHandler, submissionHandler, assessmentHandler)

	log.Printf("server listening on port %s", port)
	if err := router.Run(":" + port); err != nil {
		log.Fatalf("unable to start server: %v", err)
	}
}
