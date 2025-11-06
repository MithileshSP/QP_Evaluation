import PropTypes from "prop-types";
import { useState } from "react";

import SubmissionModal from "./SubmissionModal";
import { resolveSubmissionScore, formatScore } from "../utils/submissionScore";

function formatDate(value) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "Unknown";
  }
}

export default function SubmissionsList({
  submissions,
  loading,
  title,
  metaFormatter,
  emptyStateMessage,
  className,
  eyebrow,
}) {
  const [activeSubmission, setActiveSubmission] = useState(null);

  const metaText = metaFormatter
    ? metaFormatter({ count: submissions.length })
    : submissions.length === 0
    ? "No submissions graded yet."
    : `Showing ${submissions.length} record${
        submissions.length === 1 ? "" : "s"
      }.`;

  if (loading) {
    return (
      <section className={`panel panel--full ${className || ""}`.trim()}>
        <header className="panel__heading">
          {eyebrow && <span className="panel__eyebrow">{eyebrow}</span>}
          <h2 className="panel__title">{title}</h2>
          <p className="panel__meta">{metaText}</p>
        </header>
        <div className="loader" aria-live="polite">
          <span className="loader__dot" />
          <span className="loader__dot" />
          <span className="loader__dot" />
        </div>
      </section>
    );
  }

  return (
    <section className={`panel panel--full ${className || ""}`.trim()}>
      <header className="panel__heading">
        {eyebrow && <span className="panel__eyebrow">{eyebrow}</span>}
        <h2 className="panel__title">{title}</h2>
        <p className="panel__meta">{metaText}</p>
      </header>

      {submissions.length === 0 ? (
        <div className="empty-state">{emptyStateMessage}</div>
      ) : (
        <div className="submissions submissions--grid">
          {submissions.map((submission) => {
            const { score, maxScore } = resolveSubmissionScore(submission);
            const scoreLabel = formatScore(score);
            const maxLabel = formatScore(maxScore);
            const rawReasoning =
              submission.reasoning || "No reasoning provided.";
            const excerpt = rawReasoning.slice(0, 160);
            const isTruncated = rawReasoning.length > 160;
            const contextLabel = submission.cohortType
              ? submission.cohortType === "college"
                ? "Engineering college"
                : submission.cohortType === "school"
                ? "School"
                : submission.cohortType
              : null;
            const metaParts = [
              submission.subject,
              contextLabel,
              submission.grade,
            ]
              .filter(Boolean)
              .join(" • ");
            return (
              <article
                key={submission.id || submission._id}
                className="submission-card"
              >
                <header className="submission-card__header">
                  <div>
                    <h3 className="submission-card__title">
                      {submission.title || submission.fileName}
                    </h3>
                    {metaParts && (
                      <p className="submission-card__subject">{metaParts}</p>
                    )}
                    {submission.title && submission.fileName && (
                      <p className="submission-card__subtitle">
                        {submission.fileName}
                      </p>
                    )}
                  </div>
                  <span className="chip">
                    {scoreLabel} / {maxLabel}
                  </span>
                </header>

                <p className="submission-card__meta">
                  Evaluated on {formatDate(submission.createdAt)}
                </p>

                {submission.alignmentWarning && (
                  <p className="submission-card__warning">
                    {submission.alignmentWarning}
                  </p>
                )}

                <p className="submission-card__reasoning">
                  {excerpt}
                  {isTruncated ? "…" : ""}
                </p>

                <div className="submission-card__actions">
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => setActiveSubmission(submission)}
                  >
                    View evaluation
                  </button>
                  {submission.exportBundleReady && submission.exportDownloadUrl && (
                    <a
                      className="button button--ghost"
                      href={submission.exportDownloadUrl}
                      download
                    >
                      Download bundle
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <SubmissionModal
        submission={activeSubmission}
        onClose={() => setActiveSubmission(null)}
      />
    </section>
  );
}

SubmissionsList.propTypes = {
  submissions: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      _id: PropTypes.string,
      title: PropTypes.string,
      subject: PropTypes.string,
      grade: PropTypes.string,
      cohortType: PropTypes.string,
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
      exportBundleReady: PropTypes.bool,
      exportDownloadUrl: PropTypes.string,
    })
  ).isRequired,
  loading: PropTypes.bool,
  title: PropTypes.string,
  metaFormatter: PropTypes.func,
  emptyStateMessage: PropTypes.string,
  className: PropTypes.string,
  eyebrow: PropTypes.string,
};

SubmissionsList.defaultProps = {
  loading: false,
  title: "Previous Evaluations",
  metaFormatter: null,
  emptyStateMessage:
    "Upload your first answer sheet to see AI-generated marks and feedback.",
  className: "",
  eyebrow: "",
};
