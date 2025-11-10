import SubmissionsList from "../components/SubmissionsList";
import BulkBatchSummary from "../components/BulkBatchSummary";

function HistoryPage({ submissions, loading, bulkBatches, setBulkBatches }) {
  const historySubmissions = submissions.length > 1 ? submissions.slice(1) : [];

  return (
    <div className="app__layout app__layout--single">
      {/* Display bulk batches first */}
      {bulkBatches.map((batch) => (
        <BulkBatchSummary
          key={batch.id}
          batch={batch}
          onClear={() =>
            setBulkBatches((prev) =>
              prev.filter((item) => item.id !== batch.id)
            )
          }
          className="panel--span-12"
        />
      ))}

      {/* Display individual submissions */}
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
