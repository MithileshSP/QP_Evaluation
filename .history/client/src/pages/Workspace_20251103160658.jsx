import { useEffect, useMemo, useState } from "react";
import { fetchPrompt, updatePrompt } from "../api/prompt";
import { fetchSubmissions, uploadSubmission } from "../api/submissions";

export default function Workspace() {
  const [loading, setLoading] = useState(true);

  const [prompt, setPrompt] = useState(null);
  const [promptForm, setPromptForm] = useState({ title: "", systemPrompt: "" });
  const [promptStatus, setPromptStatus] = useState({
    saving: false,
    message: null,
    error: null,
  });

  const [submissions, setSubmissions] = useState([]);

  const [uploadState, setUploadState] = useState({ uploading: false, error: null });
  const [submissionForm, setSubmissionForm] = useState({ title: "", maxScore: "10" });
  const [selectedFile, setSelectedFile] = useState(null);

  useEffect(() => {
    const loadWorkspace = async () => {
      try {
        const [promptResponse, submissionsResponse] = await Promise.all([
          fetchPrompt(),
          fetchSubmissions(),
        ]);

        const promptData = promptResponse.data || {};
        setPrompt(promptData);
        setPromptForm({
          title: promptData.title || "",
          systemPrompt: promptData.systemPrompt || "",
        });

        setSubmissions(submissionsResponse.data || []);
      } catch (err) {
        console.error("error: unable to load workspace", err);
        setPromptStatus((prev) => ({ ...prev, error: "Failed to load prompt" }));
        setUploadState((prev) => ({ ...prev, error: "Failed to load submissions" }));
      } finally {
        setLoading(false);
      }
    };

    loadWorkspace();
  }, []);

  const handlePromptChange = (event) => {
    const { name, value } = event.target;
    setPromptForm((prev) => ({ ...prev, [name]: value }));
    setPromptStatus((prev) => ({ ...prev, message: null, error: null }));
  };

  const handlePromptSubmit = async (event) => {
    event.preventDefault();
    setPromptStatus({ saving: true, message: null, error: null });

    try {
      const { data } = await updatePrompt(promptForm);
      setPrompt(data);
      setPromptForm({
        title: data.title || "",
        systemPrompt: data.systemPrompt || "",
      });
      setPromptStatus({ saving: false, message: "Prompt updated", error: null });
    } catch (err) {
      const message = err?.response?.data?.error || "Unable to update prompt";
      setPromptStatus({ saving: false, message: null, error: message });
    }
  };

  const handleUploadFieldChange = (event) => {
    const { name, value } = event.target;
    setSubmissionForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (event) => {
    setSelectedFile(event.target.files?.[0] || null);
  };

  const handleSubmission = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setUploadState({ uploading: true, error: null });

    if (!selectedFile) {
      setUploadState({ uploading: false, error: "Please attach an image or PDF" });
      return;
    }

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      if (submissionForm.title) {
        formData.append("title", submissionForm.title);
      }
      if (submissionForm.maxScore) {
        formData.append("maxScore", submissionForm.maxScore);
      }

      const { data } = await uploadSubmission(formData);
      setSubmissions((prev) => [data, ...prev]);
      setSubmissionForm((prev) => ({ title: "", maxScore: prev.maxScore || "10" }));
      setSelectedFile(null);
      formElement.reset();
      setUploadState({ uploading: false, error: null });
    } catch (err) {
      const message = err?.response?.data?.error || "Upload failed";
      setUploadState({ uploading: false, error: message });
    }
  };

  const latestSubmission = useMemo(() => submissions[0] || null, [submissions]);

  const updatedAtText = prompt?.updatedAt
    ? new Date(prompt.updatedAt).toLocaleString()
    : "Not updated yet";

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1 className="title">AI Grading Workspace</h1>
          <p className="subtitle">
            Configure your rubric and upload answer sheets to receive instant marks and reasoning.
          </p>
        </div>
      </header>

      {loading ? (
        <section className="card card--stretch">
          <p>Loading workspace...</p>
        </section>
      ) : (
        <>
          <section className="card card--stretch">
            <h2 className="card__title">Configure Grading Prompt</h2>
            <p className="card__meta">Last updated: {updatedAtText}</p>
            <form className="form form--vertical" onSubmit={handlePromptSubmit}>
              <label className="form__label" htmlFor="promptTitle">
                Prompt Title
                <input
                  id="promptTitle"
                  name="title"
                  type="text"
                  value={promptForm.title}
                  onChange={handlePromptChange}
                  className="form__input"
                  placeholder="e.g. Grade Class 10 Physics Paper"
                  required
                />
              </label>

              <label className="form__label" htmlFor="promptInstructions">
                AI Instructions
                <textarea
                  id="promptInstructions"
                  name="systemPrompt"
                  rows={12}
                  value={promptForm.systemPrompt}
                  onChange={handlePromptChange}
                  className="form__textarea"
                  placeholder="Describe how marks should be awarded..."
                  required
                />
              </label>

              {promptStatus.error && <p className="form__error">{promptStatus.error}</p>}
              {promptStatus.message && <p className="form__success">{promptStatus.message}</p>}

              <button type="submit" className="button" disabled={promptStatus.saving}>
                {promptStatus.saving ? "Saving..." : "Save Prompt"}
              </button>
            </form>
          </section>

          <section className="card card--stretch">
            <h2 className="card__title">Upload Answer Sheet</h2>
            <form className="form form--vertical" onSubmit={handleSubmission}>
              <label className="form__label" htmlFor="submissionTitle">
                Title (optional)
                <input
                  id="submissionTitle"
                  name="title"
                  type="text"
                  value={submissionForm.title}
                  onChange={handleUploadFieldChange}
                  className="form__input"
                  placeholder="e.g. Physics Unit Test"
                />
              </label>

              <label className="form__label" htmlFor="submissionMaxScore">
                Maximum Marks
                <input
                  id="submissionMaxScore"
                  name="maxScore"
                  type="number"
                  min="1"
                  step="1"
                  value={submissionForm.maxScore}
                  onChange={handleUploadFieldChange}
                  className="form__input"
                  required
                />
              </label>

              <label className="form__label form__label--file" htmlFor="submissionFile">
                Upload Image or PDF
                <input
                  id="submissionFile"
                  name="file"
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={handleFileChange}
                  className="form__input"
                  required
                />
              </label>

              {uploadState.error && <p className="form__error">{uploadState.error}</p>}

              <button type="submit" className="button" disabled={uploadState.uploading}>
                {uploadState.uploading ? "Analyzing..." : "Submit for Evaluation"}
              </button>
            </form>
          </section>

          <section className="card card--stretch">
            <h2 className="card__title">Previous Evaluations</h2>
            {submissions.length === 0 ? (
              <p>No submissions yet. Upload your first answer sheet above.</p>
            ) : (
              <div className="submission-list">
                {submissions.map((submission) => {
                  const displayTitle = submission.title || submission.fileName;
                  return (
                    <article key={submission.id} className="submission">
                      <header className="submission__header">
                        <div>
                          <h3 className="submission__title">{displayTitle}</h3>
                          {submission.title && submission.fileName && (
                            <p className="submission__subtitle">{submission.fileName}</p>
                          )}
                        </div>
                      <span className="chip">
                        {submission.score} / {submission.maxScore}
                      </span>
                    </header>
                    <p className="submission__time">
                      Evaluated on {new Date(submission.createdAt).toLocaleString()}
                    </p>
                    <details
                      className="submission__details"
                      open={submission === latestSubmission}
                    >
                      <summary>View reasoning</summary>
                      <p>{submission.reasoning || "No reasoning returned."}</p>
                    </details>
                    <div className="submission__footer">
                      <small>Stored file: {submission.storedPath}</small>
                    </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
