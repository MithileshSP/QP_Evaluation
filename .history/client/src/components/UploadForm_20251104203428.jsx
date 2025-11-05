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
}) {
  const hasAssessment = Boolean(
    assessment?.questionPaper && assessment?.answerKey
  );

  const handleTitleChange = (event) => {
    setForm((prev) => ({ ...prev, title: event.target.value }));
  };

  const assessmentMeta = hasAssessment
    ? [
        assessment?.title ? `Title: ${assessment.title}` : null,
        assessment?.subject ? `Subject: ${assessment.subject}` : null,
        assessment?.maxScore
          ? `Max marks: ${Number(assessment.maxScore).toFixed(0)}`
          : null,
        assessment?.updatedAt
          ? `Updated: ${new Date(assessment.updatedAt).toLocaleString()}`
          : null,
      ].filter(Boolean)
    : [];

  return (
    <section className="panel">
      <header className="panel__heading">
        <h2 className="panel__title">Upload Answer Sheet</h2>
        <p className="panel__meta">
          {hasAssessment
            ? "The AI will grade using the stored question paper and answer key."
            : "Add a question paper and answer key before accepting student submissions."}
        </p>
        {assessmentMeta.length > 0 && (
          <ul className="panel__meta-list">
            {assessmentMeta.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </header>

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
};

UploadForm.defaultProps = {
  assessment: null,
  selectedFile: null,
};
