import SubmissionsList from "../components/SubmissionsList";

function HistoryPage({ submissions, loading }) {
  const historySubmissions =
    submissions.length > 1 ? submissions.slice(1) : [];

  return (
    <div className="app__layout app__layout--single">
      <SubmissionsList
        submissions={historySubmissions}
        loading={loading && !submissions[0]}
        title="Evaluation history"
        metaFormatter={({ count }) =>
          count === 0
            ? "No archived evaluations yet."
            : `Showing ${count} archived record${count === 1 ? "" : "s"}.`
        }
        emptyStateMessage="Run more evaluations to build up your archive. Each completed submission will appear here."
        className="panel--span-12 panel--history"
        eyebrow="Archive overview"
      />
    </div>
  );
}

export default HistoryPage;
