import PropTypes from "prop-types";

const filePropType =
  typeof File === "undefined" ? PropTypes.any : PropTypes.instanceOf(File);

export default function UploadForm({
  assessment,
  form,
  setForm,
  selectedFile,
  fileInputKey,
  onFileChange,
  onSubmit,
  state,
  className,
}) {
  const hasAssessment = Boolean(
    assessment?.questionPaper && assessment?.answerKey
  );

  const normalizedMaxScore =
    typeof assessment?.maxScore === "number"
      ? assessment?.maxScore
      : Number(assessment?.maxScore);

  const handleTitleChange = (event) => {
    setForm((prev) => ({ ...prev, title: event.target.value }));
  };

  const assessmentMeta = hasAssessment
    ? [
        assessment?.title
          ? { label: "Assessment", value: assessment.title }
          : null,
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
        assessment?.grade ? { label: "Grade", value: assessment.grade } : null,
        Number.isFinite(normalizedMaxScore)
          ? {
              label: "Max marks",
              value: String(Math.round(normalizedMaxScore)),
            }
          : null,
        assessment?.updatedAt
          ? {
              label: "Updated",
              value: new Date(assessment.updatedAt).toLocaleString(),
            }
          : null,
      ].filter(Boolean)
    : [];

  return (
    <section className={`panel panel--workspace ${className || ""}`.trim()}>
      <header className="panel__heading">
        <span className="panel__eyebrow">Submission intake</span>
        <h2 className="panel__title">Upload answer sheet</h2>
        <p className="panel__meta">
          {hasAssessment
            ? "The AI will grade using the stored question paper and answer key."
            : "Add a question paper and answer key before accepting student submissions."}
        </p>
      </header>

      {assessmentMeta.length > 0 && (
        <dl className="panel__stats" aria-label="Upload context">
          {assessmentMeta.map((item) => (
            <div key={item.label} className="panel__stat">
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <form className="form" onSubmit={onSubmit}>
        <label className="form__label" htmlFor="submissionTitle">
          Submission title
          <input
            id="submissionTitle"
            name="title"
            className="form__input"
            type="text"
            placeholder={
              assessment?.title
                ? `${assessment.title} – Student Submission`
                : "e.g. Midterm – Student A"
            }
            value={form.title}
            onChange={handleTitleChange}
            required
          />
          <p className="form__hint">
            Use this to identify the student or batch for the upload.
          </p>
        </label>

        <label className="form__label" htmlFor="submissionFile">
          Upload answer script
          <input
            key={fileInputKey}
            id="submissionFile"
            name="file"
            className="form__input"
            type="file"
            accept="image/*,application/pdf"
            onChange={onFileChange}
            required
            disabled={!hasAssessment}
          />
          <p className="form__hint">
            {selectedFile
              ? `Selected: ${selectedFile.name}`
              : "Choose a high quality scan or PDF (max 25 MB)."}
          </p>
        </label>

        {state.error && <p className="form__error">{state.error}</p>}

        <button
          className="button"
          type="submit"
          disabled={state.uploading || !hasAssessment}
        >
          {state.uploading ? "Analyzing..." : "Submit for evaluation"}
        </button>
      </form>
    </section>
  );
}

UploadForm.propTypes = {
  assessment: PropTypes.shape({
    id: PropTypes.string,
    title: PropTypes.string,
    subject: PropTypes.string,
    cohortType: PropTypes.string,
    grade: PropTypes.string,
    maxScore: PropTypes.number,
    updatedAt: PropTypes.string,
    questionPaper: PropTypes.object,
    answerKey: PropTypes.object,
  }),
  form: PropTypes.shape({
    title: PropTypes.string.isRequired,
  }).isRequired,
  setForm: PropTypes.func.isRequired,
  selectedFile: filePropType,
  fileInputKey: PropTypes.number.isRequired,
  onFileChange: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  state: PropTypes.shape({
    uploading: PropTypes.bool.isRequired,
    error: PropTypes.string,
  }).isRequired,
  className: PropTypes.string,
};

UploadForm.defaultProps = {
  assessment: null,
  selectedFile: null,
  className: "",
};
