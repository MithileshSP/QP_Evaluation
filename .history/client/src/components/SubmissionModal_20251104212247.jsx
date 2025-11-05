import PropTypes from "prop-types";
import { useEffect } from "react";

function formatDate(value) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "Unknown";
  }
}

function normalizeTranscript(value) {
  if (!value) {
    return "";
  }
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

export default function SubmissionModal({ submission, onClose }) {
  useEffect(() => {
    if (!submission) {
      return undefined;
    }
    const handleKey = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, submission]);

  if (!submission) {
    return null;
  }

  const transcript = normalizeTranscript(submission.transcript);
  const breakdown = Array.isArray(submission.breakdown)
    ? submission.breakdown
    : [];
  const metaParts = [submission.subject, submission.grade]
    .filter(Boolean)
    .join(" • ");

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <button className="modal__overlay" type="button" onClick={onClose}>
        <span className="sr-only">Close evaluation details</span>
      </button>
      <div className="modal__content">
        <header className="modal__header">
          <div>
            <h3 className="modal__title">
              {submission.title || submission.fileName || "Evaluation"}
            </h3>
            <p className="modal__subtitle">
              Evaluated on {formatDate(submission.createdAt)}
            </p>
            {metaParts && <p className="modal__subtitle">{metaParts}</p>}
          </div>
          <div className="modal__score">
            <span className="chip">
              {Number(submission.score).toFixed(1)} /{" "}
              {Number(submission.maxScore).toFixed(1)}
            </span>
            <button
              className="button button--ghost"
              type="button"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </header>

        {submission.alignmentWarning && (
          <p className="modal__warning">{submission.alignmentWarning}</p>
        )}

        <section className="modal__section">
          <h4>Overall Feedback</h4>
          <p>{submission.reasoning || "No reasoning provided."}</p>
        </section>

        {breakdown.length > 0 && (
          <section className="modal__section">
            <h4>Question Breakdown</h4>
            <div className="modal__table-wrapper">
              <table className="modal__table">
                <thead>
                  <tr>
                    <th scope="col">Question</th>
                    <th scope="col">Score</th>
                    <th scope="col">Max</th>
                    <th scope="col">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.map((item) => (
                    <tr
                      key={`${submission.id || submission._id}-${
                        item.questionNumber || "na"
                      }`}
                    >
                      <td>{item.questionNumber || "Question"}</td>
                      <td>{Number(item.score).toFixed(1)}</td>
                      <td>{Number(item.maxScore).toFixed(1)}</td>
                      <td>{item.reason || "No notes"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {transcript && (
          <section className="modal__section">
            <h4>Extracted Transcript</h4>
            <pre className="modal__transcript">{transcript}</pre>
          </section>
        )}
      </div>
    </div>
  );
}

SubmissionModal.propTypes = {
  submission: PropTypes.shape({
    id: PropTypes.string,
    _id: PropTypes.string,
    title: PropTypes.string,
    fileName: PropTypes.string,
    createdAt: PropTypes.string,
    score: PropTypes.number,
    maxScore: PropTypes.number,
    reasoning: PropTypes.string,
    alignmentWarning: PropTypes.string,
    breakdown: PropTypes.arrayOf(
      PropTypes.shape({
        questionNumber: PropTypes.string,
        score: PropTypes.number,
        maxScore: PropTypes.number,
        reason: PropTypes.string,
      })
    ),
    transcript: PropTypes.string,
    subject: PropTypes.string,
    grade: PropTypes.string,
  }),
  onClose: PropTypes.func.isRequired,
};

SubmissionModal.defaultProps = {
  submission: null,
};
