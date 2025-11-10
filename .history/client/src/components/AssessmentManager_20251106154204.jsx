import PropTypes from "prop-types";
import { useEffect, useState } from "react";

import { upsertAssessment } from "../api/assessment";

export default function AssessmentManager({ assessment, onSaved, className }) {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState({
    saving: false,
    error: null,
    message: null,
  });

  useEffect(() => {
    setStatus((prev) => ({ ...prev, error: null, message: null }));
  }, [assessment?.updatedAt]);

  const handleFileChange = (event) => {
    const nextFile = event.target.files?.[0] || null;
    setFile(nextFile);
    setStatus((prev) => ({ ...prev, error: null, message: null }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!file) {
      setStatus({
        saving: false,
        error: "Select a question paper to upload",
        message: null,
      });
      return;
    }

    const payload = new FormData();
    payload.append("questionPaper", file);

    setStatus({ saving: true, error: null, message: null });

    try {
      const { data } = await upsertAssessment(payload);
      setFile(null);
      setStatus({
        saving: false,
        error: null,
        message: "Question paper analyzed. Metadata and answer key refreshed.",
      });
      if (onSaved) {
        onSaved(data);
      }
    } catch (error) {
      const response = error?.response?.data;
      const message =
        response?.error ||
        response?.details ||
        error.message ||
        "Unable to analyze question paper";
      setStatus({ saving: false, error: message, message: null });
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
      <header className="panel__heading panel__heading--split">
        <div>
          <span className="panel__eyebrow">Assessment setup</span>
          <h2 className="panel__title">Question paper intake</h2>
          <p className="panel__meta">
            Upload the latest question paper. The system extracts the metadata
            and answer key automatically.
          </p>
        </div>
        {storedQuestion?.uploadedAt && (
          <p className="panel__meta panel__meta--accent">
            Uploaded {new Date(storedQuestion.uploadedAt).toLocaleString()}
          </p>
        )}
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

      <form className="form" onSubmit={handleSubmit}>
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

        {status.error && <p className="form__error">{status.error}</p>}
        {status.message && <p className="form__success">{status.message}</p>}

        <button className="button" type="submit" disabled={status.saving}>
          {status.saving ? "Analyzing..." : "Analyze question paper"}
        </button>
      </form>
    </section>
  );
}

AssessmentManager.propTypes = {
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
  onSaved: PropTypes.func,
  className: PropTypes.string,
};

AssessmentManager.defaultProps = {
  assessment: null,
  onSaved: null,
  className: "",
};
