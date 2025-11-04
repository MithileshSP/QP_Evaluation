package database

import (
	"context"
	"log"
	"os"
	"sync"
	"time"

	"github.com/joho/godotenv"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

var (
	clientInstance *mongo.Client
	clientOnce     sync.Once
)

// GetClient returns a singleton MongoDB client configured from the MONGO_URI env var.
func GetClient() *mongo.Client {
	clientOnce.Do(func() {
		if err := godotenv.Load(); err != nil {
			log.Printf("warning: unable to load .env file: %v", err)
		}

		uri := os.Getenv("MONGO_URI")
		if uri == "" {
			log.Fatal("MONGO_URI must be set in environment")
		}

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		clientOpts := options.Client().ApplyURI(uri)
		client, err := mongo.Connect(ctx, clientOpts)
		if err != nil {
			log.Fatalf("unable to connect to MongoDB: %v", err)
		}

		if err = client.Ping(ctx, nil); err != nil {
			log.Fatalf("unable to ping MongoDB: %v", err)
		}

		clientInstance = client
	})

	return clientInstance
}

// GetDatabase returns a handle to the application database.
func GetDatabase() *mongo.Database {
	dbName := os.Getenv("MONGO_DB_NAME")
	if dbName == "" {
		dbName = "grading_portal"
	}
	return GetClient().Database(dbName)
}
