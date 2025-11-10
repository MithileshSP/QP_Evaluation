import PropTypes from "prop-types";
import { useEffect, useState } from "react";

import { upsertAssessment } from "../api/assessment";

export default function AssessmentManager({ assessment, onSaved, className }) {
  const [cohortType, setCohortType] = useState("school");
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

  const gradeOptions = useMemo(() => getGradeOptions(cohortType), [cohortType]);

  useEffect(() => {
    if (!assessment) {
      setCohortType("school");
      const defaultOptions = getGradeOptions("school");
      setForm((prev) => ({ ...prev, grade: defaultOptions[0]?.value || "" }));
      return;
    }

    const detectedType =
      assessment.cohortType === "college" ? "college" : "school";
    const nextGradeOptions = getGradeOptions(detectedType);
    const resolvedGrade =
      assessment.grade &&
      nextGradeOptions.some((option) => option.value === assessment.grade)
        ? assessment.grade
        : nextGradeOptions[0]?.value || "";

    setCohortType(detectedType);
    setForm({
      title: assessment.title || "",
      subject: assessment.subject || "",
      maxScore:
        typeof assessment.maxScore === "number" &&
        !Number.isNaN(assessment.maxScore)
          ? String(Math.max(1, Math.round(assessment.maxScore)))
          : "100",
      grade: resolvedGrade,
    });
    setFiles({ questionPaper: null, answerKey: null });
    setStatus((prev) => ({ ...prev, error: null, message: null }));
  }, [assessment]);

  useEffect(() => {
    setForm((prev) => {
      if (!prev.grade) {
        return { ...prev, grade: gradeOptions[0]?.value || "" };
      }
      if (gradeOptions.some((option) => option.value === prev.grade)) {
        return prev;
      }
      return { ...prev, grade: gradeOptions[0]?.value || "" };
    });
  }, [gradeOptions]);

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleCohortTypeChange = (event) => {
    const nextType = event.target.value === "college" ? "college" : "school";
    setCohortType(nextType);
    const nextOptions = getGradeOptions(nextType);
    setForm((prev) => ({ ...prev, grade: nextOptions[0]?.value || "" }));
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
    payload.append("cohortType", cohortType);
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
      const savedType = data.cohortType === "college" ? "college" : cohortType;
      const savedOptions = getGradeOptions(savedType);
      const resolvedGrade =
        data.grade && savedOptions.some((option) => option.value === data.grade)
          ? data.grade
          : savedOptions[0]?.value || trimmedGrade;

      setStatus({ saving: false, error: null, message: "Assessment saved" });
      setFiles({ questionPaper: null, answerKey: null });
      setCohortType(savedType);
      setForm({
        title: data.title || trimmedTitle,
        subject: data.subject || trimmedSubject,
        maxScore:
          typeof data.maxScore === "number" && !Number.isNaN(data.maxScore)
            ? String(Math.max(1, Math.round(data.maxScore)))
            : String(Math.round(numericMaxScore)),
        grade: resolvedGrade,
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
    assessment?.cohortType
      ? { label: "Context", value: formatCohortType(assessment.cohortType) }
      : null,
    assessment?.grade
      ? { label: "Grade / cohort", value: assessment.grade }
      : null,
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

        <label className="form__label" htmlFor="assessmentCohortType">
          Delivery context
          <select
            id="assessmentCohortType"
            name="cohortType"
            className="form__input"
            value={cohortType}
            onChange={handleCohortTypeChange}
          >
            {COHORT_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
          <p className="form__hint">
            Choose whether these papers are for a school classroom or an
            engineering college cohort.
          </p>
        </label>

        <label className="form__label" htmlFor="assessmentGrade">
          Grade / semester
          <select
            id="assessmentGrade"
            name="grade"
            className="form__input"
            value={form.grade}
            onChange={handleInputChange}
            required
          >
            {gradeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="form__hint">
            Options automatically adjust based on the selected context. Start
            with engineering semesters; more college templates can be added
            later.
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
    cohortType: PropTypes.string,
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
