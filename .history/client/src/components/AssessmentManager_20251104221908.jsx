import PropTypes from "prop-types";
import { useEffect, useState } from "react";

import { upsertAssessment } from "../api/assessment";

export default function AssessmentManager({ assessment, onSaved, className }) {
  const [form, setForm] = useState({
    title: "",
    subject: "",
    maxScore: "100",
    grade: "",
  });
  const [files, setFiles] = useState({
    questionPaper: null,
    answerKey: null,
  });
  const [status, setStatus] = useState({
    saving: false,
    error: null,
    message: null,
  });

  useEffect(() => {
    if (!assessment) {
      return;
    }
    setForm((prev) => ({
      title: assessment.title || "",
      subject: assessment.subject || "",
      maxScore:
        typeof assessment.maxScore === "number" &&
        !Number.isNaN(assessment.maxScore)
          ? String(Math.max(1, Math.round(assessment.maxScore)))
          : prev.maxScore,
      grade: assessment.grade || prev.grade || "",
    }));
    setFiles({ questionPaper: null, answerKey: null });
    setStatus((prev) => ({ ...prev, error: null, message: null }));
  }, [
    assessment,
    assessment?.id,
    assessment?.updatedAt,
    assessment?.maxScore,
    assessment?.subject,
    assessment?.title,
  ]);

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (name) => (event) => {
    const file = event.target.files?.[0] || null;
    setFiles((prev) => ({ ...prev, [name]: file }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const trimmedTitle = form.title.trim();
    const trimmedSubject = form.subject.trim();
    const trimmedGrade = form.grade.trim();
    const numericMaxScore = Number(form.maxScore);

    if (!trimmedTitle || !trimmedSubject || !trimmedGrade) {
      setStatus({
        saving: false,
        error: "Title, subject, and grade are required",
        message: null,
      });
      return;
    }
    const validGrades = new Set([
      "Grade 6",
      "Grade 7",
      "Grade 8",
      "Grade 9",
      "Grade 10",
      "Grade 11",
      "Grade 12",
    ]);
    if (!validGrades.has(trimmedGrade)) {
      setStatus({
        saving: false,
        error: "Select a grade between 6 and 12",
        message: null,
      });
      return;
    }
    if (!Number.isFinite(numericMaxScore) || numericMaxScore <= 0) {
      setStatus({
        saving: false,
        error: "Enter a positive maximum score",
        message: null,
      });
      return;
    }

    const payload = new FormData();
    payload.append("title", trimmedTitle);
    payload.append("subject", trimmedSubject);
    payload.append("grade", trimmedGrade);
    payload.append("maxScore", String(Math.round(numericMaxScore)));

    if (files.questionPaper) {
      payload.append("questionPaper", files.questionPaper);
    }
    if (files.answerKey) {
      payload.append("answerKey", files.answerKey);
    }

    setStatus({ saving: true, error: null, message: null });

    try {
      const { data } = await upsertAssessment(payload);
      setStatus({ saving: false, error: null, message: "Assessment saved" });
      setFiles({ questionPaper: null, answerKey: null });
      setForm({
        title: data.title || trimmedTitle,
        subject: data.subject || trimmedSubject,
        maxScore:
          typeof data.maxScore === "number" && !Number.isNaN(data.maxScore)
            ? String(Math.max(1, Math.round(data.maxScore)))
            : String(Math.round(numericMaxScore)),
        grade: data.grade || trimmedGrade,
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
        "Unable to save assessment";
      setStatus({ saving: false, error: message, message: null });
    }
  };

  const questionMeta = assessment?.questionPaper || null;
  const answerMeta = assessment?.answerKey || null;
  const updatedLabel = assessment?.updatedAt
    ? new Date(assessment.updatedAt).toLocaleString()
    : null;
  const statItems = [
    assessment?.subject
      ? { label: "Subject", value: assessment.subject }
      : null,
    assessment?.grade ? { label: "Grade", value: assessment.grade } : null,
    assessment?.maxScore
      ? {
          label: "Max marks",
          value: String(Math.round(assessment.maxScore || 0)),
        }
      : null,
  ].filter(Boolean);

  return (
    <section className={`panel panel--workspace ${className || ""}`.trim()}>
      <header className="panel__heading panel__heading--split">
        <div>
          <span className="panel__eyebrow">Assessment setup</span>
          <h2 className="panel__title">Assessment materials</h2>
          <p className="panel__meta">
            Upload the question paper and answer key once. They remain active
            until you replace them.
          </p>
        </div>
        {updatedLabel && (
          <p className="panel__meta panel__meta--accent">
            Updated on {updatedLabel}
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
        <label className="form__label" htmlFor="assessmentTitle">
          Assessment title
          <input
            id="assessmentTitle"
            name="title"
            className="form__input"
            type="text"
            placeholder="e.g. Term 1 Physics"
            value={form.title}
            onChange={handleInputChange}
            required
          />
        </label>

        <label className="form__label" htmlFor="assessmentSubject">
          Subject
          <input
            id="assessmentSubject"
            name="subject"
            className="form__input"
            type="text"
            placeholder="e.g. Physics"
            value={form.subject}
            onChange={handleInputChange}
            required
          />
        </label>

        <label className="form__label" htmlFor="assessmentGrade">
          Grade level
          <select
            id="assessmentGrade"
            name="grade"
            className="form__input"
            value={form.grade}
            onChange={handleInputChange}
            required
          >
            <option value="">Select grade</option>
            <option value="Grade 6">Grade 6</option>
            <option value="Grade 7">Grade 7</option>
            <option value="Grade 8">Grade 8</option>
            <option value="Grade 9">Grade 9</option>
            <option value="Grade 10">Grade 10</option>
            <option value="Grade 11">Grade 11</option>
            <option value="Grade 12">Grade 12</option>
          </select>
          <p className="form__hint">
            Choose the grade level so the AI can adapt expectations to the
            learner&apos;s age.
          </p>
        </label>

        <label className="form__label" htmlFor="assessmentMaxScore">
          Maximum marks
          <input
            id="assessmentMaxScore"
            name="maxScore"
            className="form__input"
            type="number"
            min="1"
            step="1"
            value={form.maxScore}
            onChange={handleInputChange}
            required
          />
        </label>

        <label className="form__label" htmlFor="questionPaperFile">
          Question paper file
          <input
            id="questionPaperFile"
            name="questionPaper"
            className="form__input"
            type="file"
            accept="application/pdf,image/*"
            onChange={handleFileChange("questionPaper")}
          />
          <p className="form__hint">
            {files.questionPaper
              ? `Selected: ${files.questionPaper.name}`
              : questionMeta?.fileName
              ? `Stored: ${questionMeta.fileName}`
              : "Upload a PDF or image bundle of the exam."}
          </p>
        </label>

        <label className="form__label" htmlFor="answerKeyFile">
          Answer key file
          <input
            id="answerKeyFile"
            name="answerKey"
            className="form__input"
            type="file"
            accept="application/pdf,image/*"
            onChange={handleFileChange("answerKey")}
          />
          <p className="form__hint">
            {files.answerKey
              ? `Selected: ${files.answerKey.name}`
              : answerMeta?.fileName
              ? `Stored: ${answerMeta.fileName}`
              : "Upload the evaluated answer key or marking scheme."}
          </p>
        </label>

        {status.error && <p className="form__error">{status.error}</p>}
        {status.message && <p className="form__success">{status.message}</p>}

        <button className="button" type="submit" disabled={status.saving}>
          {status.saving ? "Saving..." : "Save assessment"}
        </button>
      </form>
    </section>
  );
}

AssessmentManager.propTypes = {
  assessment: PropTypes.shape({
    id: PropTypes.string,
    title: PropTypes.string,
    subject: PropTypes.string,
    grade: PropTypes.string,
    maxScore: PropTypes.number,
    questionPaper: PropTypes.shape({
      fileName: PropTypes.string,
    }),
    answerKey: PropTypes.shape({
      fileName: PropTypes.string,
    }),
    updatedAt: PropTypes.string,
  }),
  onSaved: PropTypes.func,
  className: PropTypes.string,
};

AssessmentManager.defaultProps = {
  assessment: null,
  onSaved: null,
  className: "",
};
