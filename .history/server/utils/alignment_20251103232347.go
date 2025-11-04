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
}

var wordMatcher = regexp.MustCompile(`[a-zA-Z]{4,}`)

// EvaluateAlignment inspects the contextual metadata against the extracted answer text.
// It returns a warning message when the content appears misaligned.
func EvaluateAlignment(subject, submissionTitle, promptTitle, promptBody, transcript, reasoning string) string {
	verificationText := strings.ToLower(strings.TrimSpace(transcript + " " + reasoning))
	if verificationText == "" {
		return ""
	}

	maxKeywords := 18
	keywordSet := make([]string, 0, maxKeywords)
	appendKeywords := func(text string) {
		if len(keywordSet) >= maxKeywords {
			return
		}
		for _, w := range extractKeywords(text) {
			if contains(keywordSet, w) {
				continue
			}
			keywordSet = append(keywordSet, w)
			if len(keywordSet) >= maxKeywords {
				break
			}
		}
	}

	appendKeywords(subject)
	appendKeywords(submissionTitle)
	appendKeywords(promptTitle)
	appendKeywords(promptBody)

	if len(keywordSet) == 0 {
		return ""
	}

	matched := 0
	missing := make([]string, 0, len(keywordSet))

	for _, keyword := range keywordSet {
		if strings.Contains(verificationText, keyword) {
			matched++
		} else {
			missing = append(missing, keyword)
		}
	}

	// Require at least two meaningful keywords before flagging.
	if len(keywordSet) < 2 {
		if matched == 0 {
			return buildWarning(missing)
		}
		return ""
	}

	matchRatio := float64(matched) / float64(len(keywordSet))
	if matched == 0 || (len(keywordSet) >= 4 && matchRatio < 0.25) || (len(keywordSet) >= 2 && matchRatio < 0.15) {
		return buildWarning(missing)
	}

	// Additional explicit subject check
	if subject != "" {
		subjectWords := extractKeywords(subject)
		missingSubject := []string{}
		for _, word := range subjectWords {
			if !strings.Contains(verificationText, word) {
				missingSubject = append(missingSubject, word)
			}
		}
		if len(missingSubject) == len(subjectWords) && len(subjectWords) > 0 {
			return buildWarning(subjectWords)
		}
	}

	return ""
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
