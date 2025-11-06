import PropTypes from "prop-types";
import { useMemo, useState } from "react";

import SubmissionModal from "./SubmissionModal";
import { resolveSubmissionScore, formatScore } from "../utils/submissionScore";

function formatDate(value) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "Unknown";
  }
}

export default function EvaluationHighlight({
  submission,
  loading,
  historyCount,
  onViewHistory,
  className,
}) {
  const [activeSubmission, setActiveSubmission] = useState(null);
  const resolvedScores = useMemo(
    () => resolveSubmissionScore(submission),
    [submission]
  );
  const scoreDisplay = formatScore(resolvedScores.score);
  const maxDisplay = formatScore(resolvedScores.maxScore);

  if (loading) {
    return (
      <section
        className={`panel panel--full highlight ${className || ""}`.trim()}
      >
        <header className="panel__heading highlight__header">
          <div>
            <span className="panel__eyebrow">Latest evaluation</span>
            <h2 className="panel__title">Preparing the latest report…</h2>
            <p className="panel__meta">
              The most recent submission will be ready shortly.
            </p>
          </div>
        </header>
        <div className="loader" aria-live="polite">
          <span className="loader__dot" />
          <span className="loader__dot" />
          <span className="loader__dot" />
        </div>
      </section>
    );
  }

  if (!submission) {
    return (
      <section
        className={`panel panel--full highlight ${className || ""}`.trim()}
      >
        <header className="panel__heading highlight__header">
          <div>
            <span className="panel__eyebrow">Latest evaluation</span>
            <h2 className="panel__title">No submissions graded yet</h2>
            <p className="panel__meta">
              Upload an answer sheet to see the freshest evaluation summary
              here.
            </p>
          </div>
        </header>
      </section>
    );
  }

  const rawReasoning = submission.reasoning || "No reasoning provided.";
  const excerpt = rawReasoning.slice(0, 220);
  const isTruncated = rawReasoning.length > 220;

  const tags = [submission.subject, submission.grade].filter(Boolean);

  return (
    <section
      className={`panel panel--full highlight ${className || ""}`.trim()}
    >
      <header className="panel__heading highlight__header">
        <div className="highlight__intro">
          <span className="panel__eyebrow">Latest evaluation</span>
          <h2 className="panel__title">
            {submission.title || submission.fileName || "Recent submission"}
          </h2>
          <p className="panel__meta">
            Evaluated on {formatDate(submission.createdAt)}
          </p>
        </div>
        <div className="highlight__score">
          <span className="highlight__score-value">
            {scoreDisplay} / {maxDisplay}
          </span>
          <span className="highlight__score-label">Total score</span>
        </div>
      </header>

      {(tags.length > 0 || resolvedScores.maxScore > 0) && (
        <div className="highlight__tags">
          {tags.map((tag) => (
            <span key={tag} className="highlight__tag">
              {tag}
            </span>
          ))}
          {resolvedScores.maxScore > 0 && (
            <span className="highlight__tag highlight__tag--muted">
              Max {maxDisplay}
            </span>
          )}
        </div>
      )}

      {submission.alignmentWarning && (
        <p className="submission-card__warning highlight__warning">
          {submission.alignmentWarning}
        </p>
      )}

      <p className="highlight__reasoning">
        {excerpt}
        {isTruncated ? "…" : ""}
      </p>

      <div className="highlight__actions">
        <button
          className="button button--secondary"
          type="button"
          onClick={() => setActiveSubmission(submission)}
        >
          View detailed report
        </button>
        {historyCount > 0 && typeof onViewHistory === "function" && (
          <button
            className="button button--ghost"
            type="button"
            onClick={onViewHistory}
          >
            Open history ({historyCount})
          </button>
        )}
      </div>

      <SubmissionModal
        submission={activeSubmission}
        onClose={() => setActiveSubmission(null)}
      />
    </section>
  );
}

EvaluationHighlight.propTypes = {
  submission: PropTypes.shape({
    id: PropTypes.string,
    _id: PropTypes.string,
    title: PropTypes.string,
    subject: PropTypes.string,
    grade: PropTypes.string,
    fileName: PropTypes.string,
    storedPath: PropTypes.string,
    score: PropTypes.number,
    maxScore: PropTypes.number,
    reasoning: PropTypes.string,
    transcript: PropTypes.string,
    alignmentWarning: PropTypes.string,
    breakdown: PropTypes.arrayOf(
      PropTypes.shape({
        questionNumber: PropTypes.string,
        score: PropTypes.number,
        maxScore: PropTypes.number,
        reason: PropTypes.string,
      })
    ),
    createdAt: PropTypes.string,
  }),
  loading: PropTypes.bool,
  historyCount: PropTypes.number,
  onViewHistory: PropTypes.func,
  className: PropTypes.string,
};

EvaluationHighlight.defaultProps = {
  submission: null,
  loading: false,
  historyCount: 0,
  onViewHistory: null,
  className: "",
};
