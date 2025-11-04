package utils

import (
	"regexp"
	"sort"
	"strings"
)

var stopwords = map[string]struct{}{
	"the": {}, "and": {}, "for": {}, "with": {}, "from": {}, "that": {},
	"this": {}, "your": {}, "will": {}, "into": {}, "about": {}, "have": {},
	"been": {}, "their": {}, "there": {}, "using": {}, "check": {}, "mark": {},
	"marks": {}, "evaluate": {}, "evaluation": {}, "answer": {}, "answers": {},
	"sheet": {}, "prompt": {}, "please": {}, "ensure": {}, "should": {},
	"questions": {}, "question": {}, "score": {}, "reason": {}, "reasons": {},
	"return": {}, "json": {}, "string": {}, "field": {}, "fields": {},
	"maximum": {}, "provide": {}, "based": {}, "detailed": {}, "deductions": {},
	"detail": {}, "details": {}, "explain": {}, "explanation": {},
	"correct": {}, "testing": {}, "test": {}, "paper": {}, "title": {},
	"subject": {}, "prompted": {}, "detect": {}, "dont": {},
}

var wordMatcher = regexp.MustCompile(`[a-zA-Z]{4,}`)

var subjectKeywords = map[string][]string{
	"physics": {
		"physics", "mechanic", "mechanics", "force", "forces", "energy", "electric",
		"electricity", "magnet", "magnetic", "wave", "waves", "microwave", "microwaves",
		"motion", "velocity", "acceleration", "thermo", "optics",
	},
	"chemistry": {
		"chemistry", "chemical", "chemicals", "molecule", "molecules", "reaction",
		"reactions", "bond", "bonds", "acid", "base", "alkali", "compound",
	},
	"mathematics": {
		"mathematics", "math", "algebra", "geometry", "calculus", "equation",
		"equations", "integral", "derivative", "proof", "theorem", "percentage",
	},
	"biology": {
		"biology", "cell", "cells", "organism", "organisms", "plant", "animal",
		"photosynthesis", "respiration", "genetics", "dna", "enzyme",
	},
	"computer science": {
		"computer", "computers", "program", "programs", "algorithm", "algorithms",
		"code", "coding", "software", "hardware", "python", "java", "javascript",
	},
	"english": {
		"english", "grammar", "essay", "literature", "poem", "poetry", "comprehension",
	},
}

var subjectAliases = map[string]string{
	"math":              "mathematics",
	"maths":             "mathematics",
	"computer":          "computer science",
	"computer science":  "computer science",
	"cs":                "computer science",
	"programming":       "computer science",
	"physics":           "physics",
	"chemistry":         "chemistry",
	"biology":           "biology",
	"english":           "english",
}

// EvaluateAlignment inspects the contextual metadata against the extracted answer text.
// It returns a warning message when the content appears misaligned.
func EvaluateAlignment(subject, submissionTitle, promptTitle, promptBody, transcript, reasoning string) string {
	verificationText := strings.ToLower(strings.TrimSpace(transcript + " " + reasoning))
	if verificationText == "" {
		return ""
	}

	subjectDisplay := strings.TrimSpace(subject)
	canonical := canonicalSubject(subject)
	if canonical == "" {
		return ""
	}

	if keywords, ok := subjectKeywords[canonical]; ok {
		if containsAny(verificationText, keywords) {
			return ""
		}
		return buildWarning(subjectDisplay, keywords)
	}

	subjectWords := extractKeywords(subject)
	if len(subjectWords) == 0 {
		return ""
	}
	if containsAny(verificationText, subjectWords) {
		return ""
	}
	return buildWarning(subjectDisplay, subjectWords)
}

func extractKeywords(text string) []string {
	lower := strings.ToLower(text)
	words := wordMatcher.FindAllString(lower, -1)
	unique := make([]string, 0, len(words))
	seen := make(map[string]struct{}, len(words))

	for _, word := range words {
		if _, skip := stopwords[word]; skip {
			continue
		}
		if len(word) < 4 {
			continue
		}
		if _, exists := seen[word]; exists {
			continue
		}
		seen[word] = struct{}{}
		unique = append(unique, word)
	}

	sort.Slice(unique, func(i, j int) bool {
		return unique[i] < unique[j]
	})

	return unique
}

func contains(slice []string, value string) bool {
	for _, item := range slice {
		if item == value {
			return true
		}
	}
	return false
}

func buildWarning(missing []string) string {
	if len(missing) == 0 {
		return ""
	}
	limit := len(missing)
	if limit > 3 {
		limit = 3
	}
	sample := missing[:limit]
	for i, word := range sample {
		sample[i] = "'" + word + "'"
	}
	message := "The uploaded answers do not mention expected terms like " + strings.Join(sample, ", ") + "."
	return message + " Adjust the subject, title, and prompt to match this file before resubmitting."
}
