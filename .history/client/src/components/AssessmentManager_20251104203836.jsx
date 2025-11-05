import PropTypes from "prop-types";
import { useEffect, useState } from "react";

import { upsertAssessment } from "../api/assessment";

const filePropType =
  typeof File === "undefined" ? PropTypes.any : PropTypes.instanceOf(File);

export default function AssessmentManager({ assessment, onSaved }) {
  const [form, setForm] = useState({
    title: "",
    subject: "",
    maxScore: "100",
  });
  const [files, setFiles] = useState({
    questionPaper: null,
    answerKey: null,
  });
  const [status, setStatus] = useState({ saving: false, error: null, message: null });

  useEffect(() => {
    if (!assessment) {
      return;
    }
    setForm((prev) => ({
      title: assessment.title || "",
      subject: assessment.subject || "",
      maxScore:
        typeof assessment.maxScore === "number" && !Number.isNaN(assessment.maxScore)
          ? String(Math.max(1, Math.round(assessment.maxScore)))
          : prev.maxScore,
    }));
    setFiles({ questionPaper: null, answerKey: null });
    setStatus((prev) => ({ ...prev, error: null, message: null }));
  }, [assessment?.id, assessment?.updatedAt, assessment?.maxScore, assessment?.subject, assessment?.title]);

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
    const numericMaxScore = Number(form.maxScore);

    if (!trimmedTitle || !trimmedSubject) {
      setStatus({ saving: false, error: "Title and subject are required", message: null });
      return;
    }
    if (!Number.isFinite(numericMaxScore) || numericMaxScore <= 0) {
      setStatus({ saving: false, error: "Enter a positive maximum score", message: null });
      return;
    }

    const payload = new FormData();
    payload.append("title", trimmedTitle);
    payload.append("subject", trimmedSubject);
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
      });
      if (onSaved) {
        onSaved(data);
      }
    } catch (error) {
      const response = error?.response?.data;
      const message =
        response?.error || response?.details || error.message || "Unable to save assessment";
      setStatus({ saving: false, error: message, message: null });
    }
  };

  const questionMeta = assessment?.questionPaper || null;
  const answerMeta = assessment?.answerKey || null;

  return (
    <section className="panel">
      <header className="panel__heading">
        <h2 className="panel__title">Assessment Materials</h2>
        <p className="panel__meta">
          Upload the question paper and answer key once. They remain active until you replace them.
        </p>
      </header>

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
};

AssessmentManager.defaultProps = {
  assessment: null,
  onSaved: null,
};
