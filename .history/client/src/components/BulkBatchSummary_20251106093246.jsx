import PropTypes from "prop-types";
import { useMemo, useState } from "react";

import SubmissionModal from "./SubmissionModal";
import { resolveSubmissionScore, formatScore } from "../utils/submissionScore";

function BatchModal({ batch, onClose }) {
  const [activeSubmission, setActiveSubmission] = useState(null);

  if (!batch) {
    return null;
  }

  const handleCloseModal = () => {
    setActiveSubmission(null);
    onClose();
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <button
        className="modal__overlay"
        type="button"
        onClick={handleCloseModal}
      >
        <span className="sr-only">Close batch results</span>
      </button>
      <div className="modal__content">
        <header className="modal__header">
          <div>
            <h3 className="modal__title">{batch.title}</h3>
            <p className="modal__subtitle">{batch.description}</p>
            <p className="modal__subtitle">
              {batch.submissions.length} submission
              {batch.submissions.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="bulk-summary__modal-actions">
            {batch.bundleUrl && (
              <a
                className="button button--secondary"
                href={batch.bundleUrl}
                download
              >
                Download archive
              </a>
            )}
            <button
              className="button button--ghost"
              type="button"
              onClick={handleCloseModal}
            >
              Close
            </button>
          </div>
        </header>

        <section className="modal__section">
          <h4>Answer scripts</h4>
          <div className="modal__table-wrapper">
            <table className="modal__table">
              <thead>
                <tr>
                  <th scope="col">File name</th>
                  <th scope="col">Student title</th>
                  <th scope="col">Marks</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {batch.submissions.map((submission) => {
                  const { score, maxScore } =
                    resolveSubmissionScore(submission);
                  return (
                    <tr key={submission.id || submission._id}>
                      <td>{submission.fileName}</td>
                      <td>{submission.title || "Untitled"}</td>
                      <td>
                        {formatScore(score)} / {formatScore(maxScore)}
                      </td>
                      <td>
                        <button
                          className="button button--secondary"
                          type="button"
                          onClick={() => setActiveSubmission(submission)}
                        >
                          View details
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <SubmissionModal
        submission={activeSubmission}
        onClose={() => setActiveSubmission(null)}
      />
    </div>
  );
}

BatchModal.propTypes = {
  batch: PropTypes.shape({
    title: PropTypes.string.isRequired,
    description: PropTypes.string.isRequired,
    submissions: PropTypes.arrayOf(PropTypes.object).isRequired,
  }),
  onClose: PropTypes.func.isRequired,
};

BatchModal.defaultProps = {
  batch: null,
};

export default function BulkBatchSummary({ batch, onClear }) {
  const [showModal, setShowModal] = useState(false);

  const summary = useMemo(() => {
    if (!batch) {
      return null;
    }
    const first = batch.submissions[0];
    const context = [first?.subject, first?.grade].filter(Boolean).join(" • ");
    return {
      context,
      updatedAt: first?.createdAt,
    };
  }, [batch]);

  if (!batch) {
    return null;
  }

  return (
    <section className="panel panel--workspace">
      <header className="panel__heading">
        <span className="panel__eyebrow">Bulk evaluation</span>
        <h2 className="panel__title">{batch.title}</h2>
        <p className="panel__meta">{batch.description}</p>
      </header>
      {summary?.context && <p className="panel__meta">{summary.context}</p>}
      {summary?.updatedAt && (
        <p className="panel__meta">
          Evaluated on {new Date(summary.updatedAt).toLocaleString()}
        </p>
      )}
      <div className="bulk-summary__actions">
        <button
          className="button button--secondary"
          type="button"
          onClick={() => setShowModal(true)}
        >
          View submissions
        </button>
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
          Dismiss
        </button>
      </div>

      {showModal && (
        <BatchModal batch={batch} onClose={() => setShowModal(false)} />
      )}
    </section>
  );
}

BulkBatchSummary.propTypes = {
  batch: PropTypes.shape({
    title: PropTypes.string.isRequired,
    description: PropTypes.string.isRequired,
    submissions: PropTypes.arrayOf(PropTypes.object).isRequired,
  }),
  onClear: PropTypes.func.isRequired,
};

BulkBatchSummary.defaultProps = {
  batch: null,
};
