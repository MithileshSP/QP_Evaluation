import PropTypes from "prop-types";

const filePropType =
  typeof File === "undefined" ? PropTypes.any : PropTypes.instanceOf(File);

export default function UploadForm({
  assessment,
  form,
  setForm,
  selectedFiles,
  fileInputKey,
  onFileChange,
  onSubmit,
  state,
  className,
}) {
  const hasAssessment = Boolean(
    assessment?.questionPaper && assessment?.answerKey
  );
  const uploadMode = form.mode === "bulk" ? "bulk" : "single";
  const normalizedMaxScore =
    typeof assessment?.maxScore === "number"
      ? assessment?.maxScore
      : Number(assessment?.maxScore);
  const selectedCount = selectedFiles?.length || 0;
  const primaryFile = selectedFiles?.[0] || null;
  const samplePrefix = (form.titlePrefix || "").trim() || "Prefix";

  const handleModeChange = (event) => {
    const nextMode = event.target.value === "bulk" ? "bulk" : "single";
    setForm((prev) => ({ ...prev, mode: nextMode }));
  };

  const handleTitleChange = (event) => {
    setForm((prev) => ({ ...prev, title: event.target.value }));
  };

  const handlePrefixChange = (event) => {
    setForm((prev) => ({ ...prev, titlePrefix: event.target.value }));
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

  const disableSubmit =
    state.uploading || !hasAssessment || selectedCount === 0;

  const submitLabel = state.uploading
    ? uploadMode === "bulk"
      ? "Evaluating batch..."
      : "Analyzing..."
    : uploadMode === "bulk"
    ? "Start bulk grading"
    : "Submit for evaluation";

  const fileInputName = uploadMode === "bulk" ? "files" : "file";

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
        <fieldset className="upload-form__fieldset">
          <legend>Upload mode</legend>
          <label className="upload-form__option">
            <input
              type="radio"
              name="uploadMode"
              value="single"
              checked={uploadMode === "single"}
              onChange={handleModeChange}
            />
            <span>Single submission</span>
          </label>
          <label className="upload-form__option">
            <input
              type="radio"
              name="uploadMode"
              value="bulk"
              checked={uploadMode === "bulk"}
              onChange={handleModeChange}
            />
            <span>Bulk batch</span>
          </label>
          <p className="form__hint">
            Bulk mode lets you upload several answer scripts together while
            reusing the same assessment files.
          </p>
        </fieldset>

        {uploadMode === "single" && (
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
              Use this to identify the student for the upload.
            </p>
          </label>
        )}

        {uploadMode === "bulk" && (
          <label className="form__label" htmlFor="bulkTitlePrefix">
            Title prefix (optional)
            <input
              id="bulkTitlePrefix"
              name="titlePrefix"
              className="form__input"
              type="text"
              placeholder="e.g. Section A"
              value={form.titlePrefix}
              onChange={handlePrefixChange}
            />
            <p className="form__hint">
              {`When set, files are named like "${samplePrefix} 01". Leave blank to use file names.`}
            </p>
          </label>
        )}

        <label className="form__label" htmlFor="submissionFile">
          {uploadMode === "bulk"
            ? "Upload answer scripts"
            : "Upload answer script"}
          <input
            key={fileInputKey}
            id="submissionFile"
            name={fileInputName}
            className="form__input"
            type="file"
            accept="image/*,application/pdf"
            multiple={uploadMode === "bulk"}
            onChange={onFileChange}
            disabled={!hasAssessment}
          />
          <p className="form__hint">
            {uploadMode === "bulk"
              ? selectedCount > 0
                ? `Selected ${selectedCount} file${
                    selectedCount === 1 ? "" : "s"
                  }. Add more to the same batch if needed.`
                : "Choose one or more high quality scans or PDFs (max 25 MB each)."
              : primaryFile
              ? `Selected: ${primaryFile.name}`
              : "Choose a high quality scan or PDF (max 25 MB)."}
          </p>
          {uploadMode === "bulk" && selectedCount > 0 && (
            <ul className="upload-form__file-list">
              {selectedFiles.slice(0, 5).map((file) => (
                <li key={`${file.name}-${file.lastModified}`}>{file.name}</li>
              ))}
              {selectedCount > 5 && <li>{`+${selectedCount - 5} more`}</li>}
            </ul>
          )}
        </label>

        {state.message && <p className="form__success">{state.message}</p>}
        {state.bundleUrl && (
          <p className="form__success">
            Combined bundle ready.{' '}
            <a href={state.bundleUrl} download>
              Download batch summary
            </a>
          </p>
        )}
        {state.error && <p className="form__error">{state.error}</p>}

        <button className="button" type="submit" disabled={disableSubmit}>
          {submitLabel}
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
    mode: PropTypes.oneOf(["single", "bulk"]).isRequired,
    title: PropTypes.string.isRequired,
    titlePrefix: PropTypes.string,
  }).isRequired,
  setForm: PropTypes.func.isRequired,
  selectedFiles: PropTypes.arrayOf(filePropType),
  fileInputKey: PropTypes.number.isRequired,
  onFileChange: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  state: PropTypes.shape({
    uploading: PropTypes.bool.isRequired,
    error: PropTypes.string,
    message: PropTypes.string,
    bundleUrl: PropTypes.string,
  }).isRequired,
  className: PropTypes.string,
};

UploadForm.defaultProps = {
  assessment: null,
  selectedFiles: [],
  className: "",
};
