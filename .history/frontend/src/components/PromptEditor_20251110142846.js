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
  const formattedDate = updatedAt
    ? new Date(updatedAt).toLocaleString()
    : "Not updated yet";

  const [file, setFile] = useState(null);
  const [assessmentStatus, setAssessmentStatus] = useState({
    saving: false,
    error: null,
    message: null,
  });

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

      <form className="form" onSubmit={onPromptSubmit}>
        <label className="form__label" htmlFor="promptInstructions">
          AI instructions (optional constraints)
          <textarea
            id="promptInstructions"
            name="systemPrompt"
            className="form__textarea"
            rows={6}
            placeholder=""
            value={promptForm.systemPrompt}
            onChange={onPromptChange}
          />
        </label>

        {status.error && <p className="form__error">{status.error}</p>}
        {status.message && <p className="form__success">{status.message}</p>}

        <button className="button button--secondary" type="submit" disabled={status.saving}>
          {status.saving ? "Saving..." : "Save constraints"}
        </button>
      </form>

      <div className="form__divider"></div>

      <form className="form" onSubmit={handleAssessmentSubmit}>
        <label className="form__label" htmlFor="questionPaperFile">
          Question paper file
          <input
            id="questionPaperFile"
            name="questionPaper"
            className="form__input"
            type="file"
            accept="application/pdf,image/*"
            onChange={handleFileChange}
          />
          <p className="form__hint">
            {file
              ? `Selected: ${file.name}`
              : storedQuestion?.fileName
              ? `Stored: ${storedQuestion.fileName}`
              : "Upload a PDF or image bundle of the exam."}
          </p>
        </label>

        {storedAnswer?.fileName && (
          <p className="form__meta">
            Generated answer key: <strong>{storedAnswer.fileName}</strong>
          </p>
        )}

        {assessmentStatus.error && <p className="form__error">{assessmentStatus.error}</p>}
        {assessmentStatus.message && <p className="form__success">{assessmentStatus.message}</p>}

        <button className="button" type="submit" disabled={assessmentStatus.saving}>
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
