package routes

import (
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"github.com/example/clg-qps/server/handlers"
)

// Register mounts all HTTP routes on the provided router.
func Register(r *gin.Engine, prompt *handlers.PromptHandler, submissions *handlers.SubmissionHandler, assessments *handlers.AssessmentHandler) {
	r.Use(cors.New(cors.Config{
		AllowOrigins: []string{"*"},
		AllowMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders: []string{"Content-Type"},
	}))

	api := r.Group("/api")
	api.GET("/assessment", assessments.GetCurrentAssessment)
	api.POST("/assessment", assessments.UpsertCurrentAssessment)
	api.GET("/prompt", prompt.GetPrompt)
	api.PUT("/prompt", prompt.UpdatePrompt)
	api.POST("/submissions", submissions.UploadSubmission)
	api.POST("/submissions/bulk", submissions.UploadBulkSubmissions)
	api.GET("/submissions", submissions.ListSubmissions)
	api.GET("/submissions/:id/export", submissions.DownloadSubmissionExport)
	api.GET("/submissions/bulk/export/:name", submissions.DownloadBatchExport)
	// Preview extracted batch contents in-browser (extracts zip to previews/ and serves files)
	api.GET("/submissions/bulk/preview/:name/*path", submissions.PreviewBatchExport)
}
