import PropTypes from "prop-types";

import EvaluationCard from "./EvaluationCard";

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
        <div className="evaluation-stack">
          {submissions.map((submission) => (
            <EvaluationCard
              key={submission.id || submission._id}
              submission={submission}
              defaultOpen={false}
              showDownload
            />
          ))}
        </div>
      )}
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
