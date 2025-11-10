import PropTypes from "prop-types";
import { useMemo, useState } from "react";

import SubmissionModal from "./SubmissionModal";
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
  const [activeSubmission, setActiveSubmission] = useState(null);

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

  const dismissLabel =
    summary.count === 0
      ? "Dismiss"
      : `Dismiss batch (${summary.count} submission$${summary.count === 1 ? "" : "s"})`;

  return (
    <section className="panel panel--workspace">
      <header className="panel__heading">
        <span className="panel__eyebrow">Bulk evaluation</span>
        <h2 className="panel__title">{batch.title}</h2>
        <p className="panel__meta">{batch.description}</p>
        {summary.count > 0 && (
          <p className="panel__meta panel__meta--accent">
            {summary.count} submission
            {summary.count === 1 ? "" : "s"} graded • Total {formatScore(summary.totals.score)} / {formatScore(summary.totals.max)} marks
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

      <div className="bulk-summary__table-wrapper">
        {batch.submissions.length === 0 ? (
          <p className="bulk-summary__empty">No submissions captured for this batch.</p>
        ) : (
          <table className="bulk-summary__table">
            <thead>
              <tr>
                <th scope="col">Answer script</th>
                <th scope="col">Student title</th>
                <th scope="col">Marks</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {batch.submissions.map((submission) => {
                const { score, maxScore } = resolveSubmissionScore(submission);
                return (
                  <tr key={submission.id || submission._id}>
                    <td>{submission.fileName}</td>
                    <td>{submission.title || "Untitled"}</td>
                    <td>
                      {formatScore(score)} / {formatScore(maxScore)}
                    </td>
                    <td>
                      <div className="bulk-summary__row-actions">
                        <button
                          className="button button--secondary"
                          type="button"
                          onClick={() => setActiveSubmission(submission)}
                        >
                          View evaluation
                        </button>
                        {submission.exportDownloadUrl && (
                          <a
                            className="button button--ghost"
                            href={submission.exportDownloadUrl}
                            download
                          >
                            Download bundle
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <SubmissionModal
        submission={activeSubmission}
        onClose={() => setActiveSubmission(null)}
      />
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
