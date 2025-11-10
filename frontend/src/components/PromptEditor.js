import PropTypes from "prop-types";
import { useEffect, useState } from "react";
import { upsertAssessment } from "../api/assessment";

export default function PromptEditor({
  promptForm,
  onPromptChange,
  onPromptSubmit,
  status,
  updatedAt,
  className,
  assessment,
  onAssessmentSaved,
}) {
  const [file, setFile] = useState(null);
  const [showConstraints, setShowConstraints] = useState(false);
  const [assessmentStatus, setAssessmentStatus] = useState({
    saving: false,
    error: null,
    message: null,
  });

  // Auto-show constraints if there's already a saved prompt
  useEffect(() => {
    if (promptForm.systemPrompt && promptForm.systemPrompt.trim() !== "") {
      setShowConstraints(true);
    }
  }, []);

  useEffect(() => {
    setAssessmentStatus((prev) => ({ ...prev, error: null, message: null }));
  }, [assessment?.updatedAt]);

  const handleFileChange = (event) => {
    const nextFile = event.target.files?.[0] || null;
    setFile(nextFile);
    setAssessmentStatus((prev) => ({ ...prev, error: null, message: null }));
  };

  const handleAssessmentSubmit = async (event) => {
    event.preventDefault();

    if (!file) {
      setAssessmentStatus({
        saving: false,
        error: "Select a question paper to upload",
        message: null,
      });
      return;
    }

    const payload = new FormData();
    payload.append("questionPaper", file);

    setAssessmentStatus({ saving: true, error: null, message: null });

    try {
      const { data } = await upsertAssessment(payload);
      setFile(null);
      setAssessmentStatus({
        saving: false,
        error: null,
        message: "Question paper analyzed. Metadata and answer key refreshed.",
      });
      if (onAssessmentSaved) {
        onAssessmentSaved(data);
      }
    } catch (error) {
      const response = error?.response?.data;
      const message =
        response?.error ||
        response?.details ||
        error.message ||
        "Unable to analyze question paper";
      setAssessmentStatus({ saving: false, error: message, message: null });
    }
  };

  const storedQuestion = assessment?.questionPaper || null;
  const storedAnswer = assessment?.answerKey || null;
  const normalizedMaxScore = Number.isFinite(assessment?.maxScore)
    ? assessment.maxScore
    : Number(assessment?.maxScore);

  const statItems = [
    assessment?.title ? { label: "Title", value: assessment.title } : null,
    assessment?.subject
      ? { label: "Subject", value: assessment.subject }
      : null,
    assessment?.cohortType
      ? {
          label: "Context",
          value:
            assessment.cohortType === "college"
              ? "College (Engineering)"
              : "School",
        }
      : null,
    assessment?.grade
      ? { label: "Grade / cohort", value: assessment.grade }
      : null,
    Number.isFinite(normalizedMaxScore)
      ? { label: "Max marks", value: String(Math.round(normalizedMaxScore)) }
      : null,
    assessment?.updatedAt
      ? {
          label: "Last updated",
          value: new Date(assessment.updatedAt).toLocaleString(),
        }
      : null,
  ].filter(Boolean);

  return (
    <section className={`panel panel--workspace ${className || ""}`.trim()}>
      <header className="panel__heading">
        <div>
          <span className="panel__eyebrow">Assessment setup</span>
          <h2 className="panel__title">Question paper intake</h2>
          <p className="panel__meta">
            Upload the latest question paper. The system extracts the metadata
            and answer key automatically.
          </p>
        </div>
      </header>

      {statItems.length > 0 && (
        <dl className="panel__stats" aria-label="Assessment metadata">
          {statItems.map((item) => (
            <div key={item.label} className="panel__stat">
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {!showConstraints && (
        <div className="constraints-toggle">
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setShowConstraints(true)}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{ marginRight: "0.5rem" }}
            >
              <path
                d="M8 3.5V12.5M3.5 8H12.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            Add AI grading constraints (optional)
          </button>
        </div>
      )}

      {showConstraints && (
        <form className="form constraints-form" onSubmit={onPromptSubmit}>
          <div className="form__header">
            <label className="form__label" htmlFor="promptInstructions">
              AI grading constraints
            </label>
            <button
              type="button"
              className="button button--ghost button--sm"
              onClick={() => {
                setShowConstraints(false);
                onPromptChange({
                  target: { name: "systemPrompt", value: "" },
                });
              }}
            >
              Remove
            </button>
          </div>

          <textarea
            id="promptInstructions"
            name="systemPrompt"
            className="form__textarea"
            rows={6}
            placeholder="e.g., Award partial marks for correct steps, prioritize clarity over brevity..."
            value={promptForm.systemPrompt}
            onChange={onPromptChange}
          />

          {status.error && <p className="form__error">{status.error}</p>}
          {status.message && <p className="form__success">{status.message}</p>}

          <button
            className="button button--secondary"
            type="submit"
            disabled={status.saving}
          >
            {status.saving ? "Saving..." : "Save constraints"}
          </button>
        </form>
      )}

      <div className="form__section-divider"></div>

      <form className="form upload-section" onSubmit={handleAssessmentSubmit}>
        <div className="upload-section__header">
          <h3 className="upload-section__title">Upload question paper</h3>
          <p className="upload-section__subtitle">
            Select a PDF or image file to analyze and extract metadata
          </p>
        </div>

        <div className="file-upload-zone">
          <label
            className={`file-upload-label ${
              file || storedQuestion?.fileName ? "has-file" : ""
            }`}
            htmlFor="questionPaperFile"
          >
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="file-upload-icon"
            >
              <path
                d="M7 18C5.17107 18 3.66667 16.4956 3.66667 14.6667C3.66667 13.0758 4.8484 11.7333 6.38642 11.5127C6.13747 10.9638 6 10.3564 6 9.72222C6 7.66117 7.66117 6 9.72222 6C10.5942 6 11.3958 6.29339 12.0265 6.78451C12.8603 4.58461 14.9303 3 17.3889 3C20.4851 3 23 5.51492 23 8.61111C23 9.41812 22.8373 10.1874 22.5445 10.8889C23.9289 11.4821 25 12.8774 25 14.5C25 16.7091 23.2091 18.5 21 18.5H16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M12 14V21M12 14L9 17M12 14L15 17"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="file-upload-text">
              {file
                ? file.name
                : storedQuestion?.fileName
                ? storedQuestion.fileName
                : "Click to select or drag file here"}
            </span>
            <span className="file-upload-hint">
              PDF or image files accepted
            </span>
            <input
              id="questionPaperFile"
              name="questionPaper"
              className="file-upload-input"
              type="file"
              accept="application/pdf,image/*"
              onChange={handleFileChange}
            />
          </label>
        </div>

        {storedAnswer?.fileName && (
          <p className="form__meta">
            Generated answer key: <strong>{storedAnswer.fileName}</strong>
          </p>
        )}

        {assessmentStatus.error && (
          <p className="form__error">{assessmentStatus.error}</p>
        )}
        {assessmentStatus.message && (
          <p className="form__success">{assessmentStatus.message}</p>
        )}

        <button
          className="button"
          type="submit"
          disabled={assessmentStatus.saving}
        >
          {assessmentStatus.saving ? "Analyzing..." : "Analyze question paper"}
        </button>
      </form>
    </section>
  );
}

PromptEditor.propTypes = {
  promptForm: PropTypes.shape({
    systemPrompt: PropTypes.string.isRequired,
  }).isRequired,
  onPromptChange: PropTypes.func.isRequired,
  onPromptSubmit: PropTypes.func.isRequired,
  status: PropTypes.shape({
    saving: PropTypes.bool.isRequired,
    message: PropTypes.string,
    error: PropTypes.string,
  }).isRequired,
  updatedAt: PropTypes.string,
  className: PropTypes.string,
  assessment: PropTypes.shape({
    title: PropTypes.string,
    subject: PropTypes.string,
    cohortType: PropTypes.string,
    grade: PropTypes.string,
    maxScore: PropTypes.number,
    updatedAt: PropTypes.string,
    questionPaper: PropTypes.shape({
      fileName: PropTypes.string,
      uploadedAt: PropTypes.string,
    }),
    answerKey: PropTypes.shape({
      fileName: PropTypes.string,
    }),
  }),
  onAssessmentSaved: PropTypes.func,
};

PromptEditor.defaultProps = {
  updatedAt: undefined,
  className: "",
  assessment: null,
  onAssessmentSaved: null,
};
