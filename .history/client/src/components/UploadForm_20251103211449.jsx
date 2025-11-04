import PropTypes from "prop-types";
import { useMemo } from "react";

const SUBJECT_OPTIONS = [
  { value: "", label: "Select subject" },
  { value: "physics", label: "Physics" },
  { value: "chemistry", label: "Chemistry" },
  { value: "mathematics", label: "Mathematics" },
  { value: "biology", label: "Biology" },
  { value: "english", label: "English" },
];

export default function UploadForm({
  form,
  setForm,
  selectedFile,
  onFileChange,
  onSubmit,
  state,
}) {
  const selectedSubject = useMemo(
    () => SUBJECT_OPTIONS.find((option) => option.value === form.subject) || SUBJECT_OPTIONS[0],
    [form.subject]
  );

  return (
    <section className="panel">
      <header className="panel__heading">
        <h2 className="panel__title">Upload Answer Sheet</h2>
        <p className="panel__meta">
          Attach a clear image (JPG/PNG) or PDF export. The AI will grade it using your latest prompt.
        </p>
      </header>

      <form className="form" onSubmit={onSubmit}>
        <label className="form__label" htmlFor="submissionSubject">
          Subject
          <select
            id="submissionSubject"
            name="subject"
            className="form__select"
            value={form.subject}
            onChange={(event) => setForm((prev) => ({ ...prev, subject: event.target.value }))}
            required
          >
            {SUBJECT_OPTIONS.map((option) => (
              <option key={option.value || "placeholder"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="form__label" htmlFor="submissionTitle">
          Paper title
          <input
            id="submissionTitle"
            name="title"
            className="form__input"
            type="text"
            placeholder={`e.g. ${selectedSubject.value ? `${selectedSubject.label} Unit Test` : "Mid Term Evaluation"}`}
            value={form.title}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            required
          />
        </label>

        <label className="form__label" htmlFor="submissionMaxScore">
          Maximum marks
          <input
            id="submissionMaxScore"
            name="maxScore"
            className="form__input"
            type="number"
            min="1"
            step="1"
            value={form.maxScore}
            onChange={(event) => setForm((prev) => ({ ...prev, maxScore: event.target.value }))}
            required
          />
        </label>

        <label className="form__label" htmlFor="submissionFile">
          Upload file
          <input
            id="submissionFile"
            name="file"
            className="form__input"
            type="file"
            accept="image/*,application/pdf"
            onChange={onFileChange}
            required
          />
          <p className="form__hint">
            {selectedFile ? `Selected: ${selectedFile.name}` : "Choose a high quality scan or PDF (max 25 MB)"}
          </p>
        </label>

        {state.error && <p className="form__error">{state.error}</p>}

        <button className="button" type="submit" disabled={state.uploading}>
          {state.uploading ? "Analyzing..." : "Submit for evaluation"}
        </button>
      </form>
    </section>
  );
}

UploadForm.propTypes = {
  form: PropTypes.shape({
    subject: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    maxScore: PropTypes.string.isRequired,
  }).isRequired,
  setForm: PropTypes.func.isRequired,
  selectedFile: PropTypes.instanceOf(File),
  onFileChange: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  state: PropTypes.shape({
    uploading: PropTypes.bool.isRequired,
    error: PropTypes.string,
  }).isRequired,
};
