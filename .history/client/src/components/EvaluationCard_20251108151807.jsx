import PropTypes from "prop-types";
import { useMemo, useState } from "react";

import EvaluationDetails from "./EvaluationDetails";
import { resolveSubmissionScore, formatScore } from "../utils/submissionScore";

function formatDate(value) {
  if (!value) {
    return "Unknown";
  }
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "Unknown";
  }
}

function formatContext({ subject, cohortType, grade }) {
  const contextLabel = cohortType
    ? cohortType === "college"
      ? "Engineering college"
      : cohortType === "school"
      ? "School"
      : cohortType
    : null;
  return [subject, contextLabel, grade].filter(Boolean).join(" • ");
}

export default function EvaluationCard({
  submission,
  defaultOpen,
  showDownload,
  variant,
}) {
  const [expanded, setExpanded] = useState(Boolean(defaultOpen));

  const resolvedScores = useMemo(
    () => resolveSubmissionScore(submission),
    [submission]
  );

  if (!submission) {
    return null;
  }

  const context = formatContext(submission);
  const toggleLabel = expanded ? "Hide detailed report" : "View detailed report";
  const cardClasses = [
    "evaluation-card",
    expanded ? "evaluation-card--expanded" : "",
    variant ? `evaluation-card--${variant}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={cardClasses}>
      <header className="evaluation-card__header">
        <div className="evaluation-card__intro">
          <h3 className="evaluation-card__title">
            {submission.title || submission.fileName || "Evaluation"}
          </h3>
          <p className="evaluation-card__timestamp">
            Evaluated on {formatDate(submission.createdAt)}
          </p>
          {context && <p className="evaluation-card__context">{context}</p>}
        </div>
        <div className="evaluation-card__score">
          <span className="evaluation-card__score-value">
            {formatScore(resolvedScores.score)} / {formatScore(resolvedScores.maxScore)}
          </span>
          <span className="evaluation-card__score-label">Total marks</span>
          <div className="evaluation-card__actions">
            <button
              className="button button--secondary"
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
            >
              {toggleLabel}
            </button>
            {showDownload &&
              submission.exportBundleReady &&
              submission.exportDownloadUrl && (
                <a
                  className="button button--ghost"
                  href={submission.exportDownloadUrl}
                  download
                >
                  Download bundle
                </a>
              )}
          </div>
        </div>
      </header>

      {expanded && <EvaluationDetails submission={submission} />}
    </article>
  );
}

EvaluationCard.propTypes = {
  submission: PropTypes.shape({
    id: PropTypes.string,
    _id: PropTypes.string,
    title: PropTypes.string,
    subject: PropTypes.string,
    grade: PropTypes.string,
    cohortType: PropTypes.string,
    fileName: PropTypes.string,
    createdAt: PropTypes.string,
    reasoning: PropTypes.string,
    alignmentWarning: PropTypes.string,
    transcript: PropTypes.string,
    breakdown: PropTypes.arrayOf(
      PropTypes.shape({
        questionNumber: PropTypes.string,
        score: PropTypes.number,
        maxScore: PropTypes.number,
        reason: PropTypes.string,
      })
    ),
    exportBundleReady: PropTypes.bool,
    exportDownloadUrl: PropTypes.string,
    maxScore: PropTypes.number,
    score: PropTypes.number,
  }),
  defaultOpen: PropTypes.bool,
  showDownload: PropTypes.bool,
  variant: PropTypes.oneOf(["", "spotlight", "compact"]),
};

EvaluationCard.defaultProps = {
  submission: null,
  defaultOpen: false,
  showDownload: true,
  variant: "",
};
