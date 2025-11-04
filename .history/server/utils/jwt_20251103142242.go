package utils

import (
    "errors"
    "os"
    "time"

    "github.com/golang-jwt/jwt/v5"
)

// Claims represents our JWT payload.
type Claims struct {
    UserID string `json:"userId"`
    Role   string `json:"role"`
    jwt.RegisteredClaims
}

// GenerateToken issues a JWT for a given user identifier and role.
func GenerateToken(userID, role string) (string, error) {
    secret := os.Getenv("JWT_SECRET")
    if secret == "" {
        return "", errors.New("JWT_SECRET not configured")
    }

    claims := Claims{
        UserID: userID,
        Role:   role,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
            IssuedAt:  jwt.NewNumericDate(time.Now()),
        },
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    return token.SignedString([]byte(secret))
}

// ParseToken validates a JWT string and returns its claims.
func ParseToken(tokenString string) (*Claims, error) {
    secret := os.Getenv("JWT_SECRET")
    if secret == "" {
        return nil, errors.New("JWT_SECRET not configured")
    }

    token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
        return []byte(secret), nil
    })
    if err != nil {
        return nil, err
    }

    claims, ok := token.Claims.(*Claims)
    if !ok || !token.Valid {
        return nil, errors.New("invalid token claims")
    }

    return claims, nil
}
