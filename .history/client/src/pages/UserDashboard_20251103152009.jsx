import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { fetchPrompt } from "../api/prompt";
import { fetchSubmissions, uploadSubmission } from "../api/submissions";

export default function UserDashboard() {
  const { user, logout } = useAuth();
  const [prompt, setPrompt] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadState, setUploadState] = useState({
    uploading: false,
    error: null,
  });
  const [form, setForm] = useState({ title: "", maxScore: "10" });
  const [selectedFile, setSelectedFile] = useState(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [promptResponse, submissionsResponse] = await Promise.all([
          fetchPrompt(),
          fetchSubmissions(),
        ]);
        setPrompt(promptResponse.data);
        setSubmissions(submissionsResponse.data || []);
      } catch (err) {
        console.error("error: unable to load dashboard data", err);
        setUploadState((prev) => ({ ...prev, error: "Failed to load data" }));
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (event) => {
    setSelectedFile(event.target.files?.[0] || null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setUploadState({ uploading: true, error: null });

    if (!selectedFile) {
      setUploadState({
        uploading: false,
        error: "Please attach an image or PDF",
      });
      return;
    }

    try {
      const data = new FormData();
      data.append("file", selectedFile);
      if (form.title) {
        data.append("title", form.title);
      }
      if (form.maxScore) {
        data.append("maxScore", form.maxScore);
      }

      const response = await uploadSubmission(data);
      setSubmissions((prev) => [response.data, ...prev]);
      setForm({ title: "", maxScore: form.maxScore || "10" });
      setSelectedFile(null);
      formElement.reset();
      setUploadState({ uploading: false, error: null });
    } catch (err) {
      const message = err?.response?.data?.error || "Upload failed";
      setUploadState({ uploading: false, error: message });
    }
  };

  const latestSubmission = useMemo(() => submissions[0] || null, [submissions]);

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1 className="title">Evaluation Workspace</h1>
          <p className="subtitle">
            Upload your handwritten answers to see AI-generated marks.
          </p>
        </div>
        <div className="header__actions">
          <span className="chip">
            {user?.username} · {user?.role}
          </span>
          <button className="button button--ghost" onClick={logout}>
            Log Out
          </button>
        </div>
      </header>

      {loading ? (
        <section className="card card--stretch">
          <p>Loading your data...</p>
        </section>
      ) : (
        <>
          <section className="card card--stretch">
            <h2 className="card__title">Upload Answer Sheet</h2>
            <form className="form form--vertical" onSubmit={handleSubmit}>
              <label className="form__label" htmlFor="title">
                Title (optional)
                <input
                  id="title"
                  name="title"
                  type="text"
                  value={form.title}
                  onChange={handleInputChange}
                  className="form__input"
                  placeholder="e.g. Physics Unit Test"
                />
              </label>

              <label className="form__label" htmlFor="maxScore">
                Maximum Marks
                <input
                  id="maxScore"
                  name="maxScore"
                  type="number"
                  min="1"
                  step="1"
                  value={form.maxScore}
                  onChange={handleInputChange}
                  className="form__input"
                  required
                />
              </label>

              <label className="form__label form__label--file" htmlFor="file">
                Upload Image or PDF
                <input
                  id="file"
                  name="file"
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={handleFileChange}
                  className="form__input"
                  required
                />
              </label>

              {uploadState.error && (
                <p className="form__error">{uploadState.error}</p>
              )}

              <button
                type="submit"
                className="button"
                disabled={uploadState.uploading}
              >
                {uploadState.uploading
                  ? "Analyzing..."
                  : "Submit for Evaluation"}
              </button>
            </form>
          </section>

          {prompt && (
            <section className="card">
              <h2 className="card__title">Current Rubric</h2>
              <p className="card__meta">{prompt.title}</p>
              <pre className="card__prompt">{prompt.systemPrompt}</pre>
            </section>
          )}

          <section className="card card--stretch">
            <h2 className="card__title">Previous Evaluations</h2>
            {submissions.length === 0 ? (
              <p>No submissions yet. Upload your first answer sheet above.</p>
            ) : (
              <div className="submission-list">
                {submissions.map((submission) => (
                  <article key={submission.id} className="submission">
                    <header className="submission__header">
                      <h3 className="submission__title">
                        {submission.fileName}
                      </h3>
                      <span className="chip">
                        {submission.score} / {submission.maxScore}
                      </span>
                    </header>
                    <p className="submission__time">
                      Evaluated on{" "}
                      {new Date(submission.createdAt).toLocaleString()}
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
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
