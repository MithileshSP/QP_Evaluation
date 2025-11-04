import PropTypes from "prop-types";

function formatDate(value) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "Unknown";
  }
}

export default function SubmissionsList({ submissions, loading }) {
  if (loading) {
    return (
      <section className="panel panel--full">
        <header className="panel__heading">
          <h2 className="panel__title">Previous Evaluations</h2>
          <p className="panel__meta">
            Recent uploads will appear here once the AI completes grading.
          </p>
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
    <section className="panel panel--full">
      <header className="panel__heading">
        <h2 className="panel__title">Previous Evaluations</h2>
        <p className="panel__meta">
          {submissions.length === 0
            ? "No submissions graded yet."
            : `Showing ${submissions.length} record${
                submissions.length === 1 ? "" : "s"
              }.`}
        </p>
      </header>

      {submissions.length === 0 ? (
        <div className="empty-state">
          Upload your first answer sheet to see AI-generated marks and feedback.
        </div>
      ) : (
        <div className="submissions">
          {submissions.map((submission) => (
            <article
              key={submission.id || submission._id}
              className="submission-card"
            >
              <header className="submission-card__header">
                <div>
                  <h3 className="submission-card__title">
                    {submission.title || submission.fileName}
                  </h3>
                  {submission.subject && (
                    <p className="submission-card__subject">
                      Subject: {submission.subject}
                    </p>
                  )}
                  {submission.title && submission.fileName && (
                    <p className="submission-card__subtitle">
                      {submission.fileName}
                    </p>
                  )}
                </div>
                <span className="chip">
                  {Number(submission.score).toFixed(1)} /{" "}
                  {Number(submission.maxScore).toFixed(1)}
                </span>
              </header>

              <p className="submission-card__meta">
                Evaluated on {formatDate(submission.createdAt)}
              </p>
              <p className="submission-card__reasoning">
                {submission.reasoning || "No reasoning provided."}
              </p>
              <p className="submission-card__meta">
                Stored file: {submission.storedPath}
              </p>
            </article>
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
      fileName: PropTypes.string,
      storedPath: PropTypes.string,
      score: PropTypes.number,
      maxScore: PropTypes.number,
      reasoning: PropTypes.string,
      createdAt: PropTypes.string,
    })
  ).isRequired,
  loading: PropTypes.bool,
};

SubmissionsList.defaultProps = {
  loading: false,
};
