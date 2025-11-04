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
		"number", "numbers", "formula", "formulas", "fraction", "fractions",
		"solve", "solution", "solutions", "calculate", "calculation", "value", "values",
		"angle", "angles", "triangle", "triangles", "trigonometry", "probability",
		"statistics", "statistic", "matrix", "matrices", "function", "functions",
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
	"math":             "mathematics",
	"maths":            "mathematics",
	"computer":         "computer science",
	"computer science": "computer science",
	"cs":               "computer science",
	"programming":      "computer science",
	"physics":          "physics",
	"chemistry":        "chemistry",
	"biology":          "biology",
	"english":          "english",
}

// EvaluateAlignment inspects the contextual metadata against the extracted answer text.
// It returns a warning message when the content appears misaligned.
func EvaluateAlignment(subject string, _ string, _ string, _ string, transcript, reasoning string) string {
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
		if matchesSubject(canonical, verificationText) {
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

func canonicalSubject(value string) string {
	trimmed := strings.ToLower(strings.TrimSpace(value))
	if trimmed == "" {
		return ""
	}
	trimmed = strings.ReplaceAll(trimmed, "-", " ")
	trimmed = strings.ReplaceAll(trimmed, "_", " ")
	trimmed = strings.Join(strings.Fields(trimmed), " ")

	if canonical, ok := subjectAliases[trimmed]; ok {
		return canonical
	}

	for alias, canonical := range subjectAliases {
		if strings.Contains(trimmed, alias) {
			return canonical
		}
	}

	for key := range subjectKeywords {
		if strings.Contains(trimmed, key) {
			return key
		}
	}

	return trimmed
}

func containsAny(text string, keywords []string) bool {
	for _, keyword := range keywords {
		if keyword == "" {
			continue
		}
		if strings.Contains(text, keyword) {
			return true
		}
	}
	return false
}

func matchesSubject(subject, text string) bool {
	keywords, ok := subjectKeywords[subject]
	if !ok {
		return false
	}
	if containsAny(text, keywords) {
		return true
	}
	switch subject {
	case "mathematics":
		if digitPattern.MatchString(text) {
			return true
		}
		if containsAny(text, mathSymbolTokens) {
			return true
		}
	}
	return false
}

func buildWarning(subject string, keywords []string) string {
	if len(keywords) == 0 {
		return "The uploaded answers do not appear to match the selected subject. Adjust the subject, title, and prompt to match this file before resubmitting."
	}
	limit := len(keywords)
	if limit > 3 {
		limit = 3
	}
	sample := make([]string, limit)
	for i := 0; i < limit; i++ {
		sample[i] = "'" + keywords[i] + "'"
	}
	subjectLabel := strings.TrimSpace(subject)
	if subjectLabel == "" {
		subjectLabel = "this subject"
	}
	return "The uploaded answers do not mention keywords associated with " + subjectLabel + ", such as " + strings.Join(sample, ", ") + ". Adjust the subject, title, and prompt to match this file before resubmitting."
}
