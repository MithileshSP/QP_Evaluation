import PropTypes from "prop-types";

import { resolveSubmissionScore, formatScore } from "../utils/submissionScore";

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

function formatReasoning(text) {
  if (!text) {
    return "No reasoning provided.";
  }
  return text;
}

function formatBreakdownItems(breakdown) {
  if (!Array.isArray(breakdown)) {
    return [];
  }
  return breakdown.map((item, index) => ({
    key: item?.questionNumber || `question-${index + 1}`,
    question: item?.questionNumber || `Question ${index + 1}`,
    score: formatScore(item?.score ?? 0),
    maxScore: formatScore(item?.maxScore ?? 0),
    reason: item?.reason || "No notes",
  }));
}

export default function EvaluationDetails({ submission }) {
  if (!submission) {
    return null;
  }

  const transcript = normalizeTranscript(submission.transcript);
  const breakdownItems = formatBreakdownItems(submission.breakdown);
  const { score, maxScore } = resolveSubmissionScore(submission);

  return (
    <div className="evaluation-card__body">
      {submission.alignmentWarning && (
        <p className="evaluation-card__warning">
          {submission.alignmentWarning}
        </p>
      )}

      <section className="evaluation-card__section">
        <h4>Overall Feedback</h4>
        <p>{formatReasoning(submission.reasoning)}</p>
      </section>

      {breakdownItems.length > 0 && (
        <section className="evaluation-card__section">
          <h4>Question Breakdown</h4>
          <div className="evaluation-card__table-wrapper">
            <table className="evaluation-card__table">
              <thead>
                <tr>
                  <th scope="col">Question</th>
                  <th scope="col">Score</th>
                  <th scope="col">Max</th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                {breakdownItems.map((item) => (
                  <tr key={item.key}>
                    <td>{item.question}</td>
                    <td>{item.score}</td>
                    <td>{item.maxScore}</td>
                    <td>{item.reason}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td>{formatScore(score)}</td>
                  <td>{formatScore(maxScore)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {transcript && (
        <section className="evaluation-card__section">
          <h4>Extracted Transcript</h4>
          <pre className="evaluation-card__transcript">{transcript}</pre>
        </section>
      )}
    </div>
  );
}

EvaluationDetails.propTypes = {
  submission: PropTypes.shape({
    reasoning: PropTypes.string,
    alignmentWarning: PropTypes.string,
    transcript: PropTypes.string,
    breakdown: PropTypes.arrayOf(
      PropTypes.shape({
        questionNumber: PropTypes.string,
        score: PropTypes.number,
        maxScore: PropTypes.number,
        reason: PropTypes.string,
      })
    ),
  }),
};

EvaluationDetails.defaultProps = {
  submission: null,
};
