import PropTypes from "prop-types";

import EvaluationCard from "./EvaluationCard";

export default function EvaluationHighlight({
  submission,
  loading,
  historyCount,
  onViewHistory,
  className,
}) {
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

  return (
    <section
      className={`panel panel--full highlight ${className || ""}`.trim()}
    >
      <header className="panel__heading panel__heading--split">
        <div>
          <span className="panel__eyebrow">Latest evaluation</span>
          <h2 className="panel__title">Detailed report</h2>
          <p className="panel__meta">
            {historyCount > 0
              ? `Most recent submission shown below. ${historyCount} previous evaluation${
                  historyCount === 1 ? "" : "s"
                } available in history.`
              : "Most recent submission shown below."}
          </p>
        </div>
        {historyCount > 0 && typeof onViewHistory === "function" && (
          <button
            className="button button--ghost"
            type="button"
            onClick={onViewHistory}
          >
            Open history
          </button>
        )}
      </header>
      <EvaluationCard
        submission={submission}
        defaultOpen
        showDownload
        variant="spotlight"
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
    cohortType: PropTypes.string,
    exportBundleReady: PropTypes.bool,
    exportDownloadUrl: PropTypes.string,
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
