package middlewares

import (
    "net/http"
    "strings"

    "github.com/gin-gonic/gin"

    "github.com/example/clg-qps/server/utils"
)

// AuthRequired ensures the request contains a valid JWT token.
func AuthRequired() gin.HandlerFunc {
    return func(c *gin.Context) {
        authHeader := c.GetHeader("Authorization")
        if authHeader == "" {
            c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing authorization header"})
            return
        }

        parts := strings.SplitN(authHeader, " ", 2)
        if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
            c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid authorization header"})
            return
        }

        claims, err := utils.ParseToken(parts[1])
        if err != nil {
            c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired token"})
            return
        }

        c.Set("userId", claims.UserID)
        c.Set("role", claims.Role)
        c.Next()
    }
}

// RequireRole ensures the authenticated user has one of the specified roles.
func RequireRole(roles ...string) gin.HandlerFunc {
    allowed := make(map[string]struct{}, len(roles))
    for _, role := range roles {
        allowed[role] = struct{}{}
    }

    return func(c *gin.Context) {
        role := c.GetString("role")
        if _, ok := allowed[role]; !ok {
            c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "insufficient permissions"})
            return
        }
        c.Next()
    }
}
