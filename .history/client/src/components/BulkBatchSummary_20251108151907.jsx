import PropTypes from "prop-types";
import { useMemo } from "react";

import EvaluationCard from "./EvaluationCard";
import { resolveSubmissionScore, formatScore } from "../utils/submissionScore";

function formatCohortLabel(value) {
  if (!value) {
    return null;
  }
  if (value === "college") {
    return "Engineering college";
  }
  if (value === "school") {
    return "School";
  }
  return value;
}

export default function BulkBatchSummary({ batch, onClear }) {
  const summary = useMemo(() => {
    const submissions = Array.isArray(batch?.submissions)
      ? batch.submissions
      : [];
    if (submissions.length === 0) {
      return {
        count: 0,
        context: "",
        createdAt: batch?.createdAt || null,
        totals: { score: 0, max: 0 },
      };
    }

    const first = submissions[0];
    const contextParts = [
      first?.subject,
      formatCohortLabel(first?.cohortType),
      first?.grade,
    ].filter(Boolean);
    const totals = submissions.reduce(
      (acc, submission) => {
        const { score, maxScore } = resolveSubmissionScore(submission);
        return {
          score: acc.score + score,
          max: acc.max + maxScore,
        };
      },
      { score: 0, max: 0 }
    );

    return {
      count: submissions.length,
      context: contextParts.join(" • "),
      createdAt: batch?.createdAt || first?.createdAt || null,
      totals,
    };
  }, [batch]);

  if (!batch) {
    return null;
  }

  const submissions = Array.isArray(batch.submissions)
    ? batch.submissions
    : [];

  const dismissLabel =
    summary.count === 0
      ? "Dismiss"
      : `Dismiss batch (${summary.count} submission${
          summary.count === 1 ? "" : "s"
        })`;

  return (
    <section className="panel panel--workspace">
      <header className="panel__heading">
        <span className="panel__eyebrow">Bulk evaluation</span>
        <h2 className="panel__title">{batch.title}</h2>
        <p className="panel__meta">{batch.description}</p>
        {summary.count > 0 && (
          <p className="panel__meta panel__meta--accent">
            {summary.count} submission
            {summary.count === 1 ? "" : "s"} graded • Total{" "}
            {formatScore(summary.totals.score)} /{" "}
            {formatScore(summary.totals.max)} marks
          </p>
        )}
        {summary.context && <p className="panel__meta">{summary.context}</p>}
        {summary.createdAt && (
          <p className="panel__meta">
            Evaluated on {new Date(summary.createdAt).toLocaleString()}
          </p>
        )}
      </header>

      <div className="bulk-summary__actions">
        {batch.bundleUrl && (
          <a className="button" href={batch.bundleUrl} download>
            Download archive
          </a>
        )}
        <button
          className="button button--ghost"
          type="button"
          onClick={onClear}
        >
          {dismissLabel}
        </button>
      </div>

      <details className="bulk-folder" open>
        <summary className="bulk-folder__summary">
          <span className="bulk-folder__title">{batch.title}</span>
          <span className="bulk-folder__meta">
            {summary.count} submission
            {summary.count === 1 ? "" : "s"} • Total {formatScore(summary.totals.score)} / {formatScore(summary.totals.max)} marks
          </span>
        </summary>

        <div className="bulk-folder__items">
          {submissions.length === 0 ? (
            <p className="bulk-summary__empty">
              No submissions captured for this batch.
            </p>
          ) : (
            submissions.map((submission) => (
              <EvaluationCard
                key={submission.id || submission._id}
                submission={submission}
                defaultOpen={false}
                showDownload
                variant="compact"
              />
            ))
          )}
        </div>
      </details>
    </section>
  );
}

BulkBatchSummary.propTypes = {
  batch: PropTypes.shape({
    id: PropTypes.string,
    title: PropTypes.string.isRequired,
    description: PropTypes.string.isRequired,
    bundleUrl: PropTypes.string,
    createdAt: PropTypes.string,
    submissions: PropTypes.arrayOf(PropTypes.object).isRequired,
  }),
  onClear: PropTypes.func.isRequired,
};

BulkBatchSummary.defaultProps = {
  batch: null,
};
