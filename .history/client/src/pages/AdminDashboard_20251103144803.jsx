import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { fetchPrompt, updatePrompt } from "../api/prompt";

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const [prompt, setPrompt] = useState({ title: "", systemPrompt: "" });
  const [status, setStatus] = useState({ loading: true, saving: false, message: null, error: null });

  useEffect(() => {
    const loadPrompt = async () => {
      try {
        const { data } = await fetchPrompt();
        setPrompt({ title: data.title || "", systemPrompt: data.systemPrompt || "" });
        setStatus((prev) => ({ ...prev, loading: false }));
      } catch (err) {
        setStatus({ loading: false, saving: false, message: null, error: "Unable to load prompt" });
      }
    };
    loadPrompt();
  }, []);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setPrompt((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus({ loading: false, saving: true, message: null, error: null });
    try {
      await updatePrompt(prompt);
      setStatus({ loading: false, saving: false, message: "Prompt updated successfully", error: null });
    } catch (err) {
      const message = err?.response?.data?.error || "Failed to update prompt";
      setStatus({ loading: false, saving: false, message: null, error: message });
    }
  };

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1 className="title">Admin Console</h1>
          <p className="subtitle">Configure the grading rubric for AI evaluations.</p>
        </div>
        <div className="header__actions">
          <span className="chip">{user?.username} · {user?.role}</span>
          <button className="button button--ghost" onClick={logout}>
            Log Out
          </button>
        </div>
      </header>

      <section className="card card--stretch">
        {status.loading ? (
          <p>Loading prompt...</p>
        ) : (
          <form className="form form--vertical" onSubmit={handleSubmit}>
            <label className="form__label" htmlFor="title">
              Prompt Title
              <input
                id="title"
                name="title"
                type="text"
                value={prompt.title}
                onChange={handleChange}
                className="form__input"
                placeholder="e.g. Grade Class 10 Science Paper"
                required
              />
            </label>

            <label className="form__label" htmlFor="systemPrompt">
              AI Instructions
              <textarea
                id="systemPrompt"
                name="systemPrompt"
                rows={12}
                value={prompt.systemPrompt}
                onChange={handleChange}
                className="form__textarea"
                placeholder="Describe how marks should be awarded..."
                required
              />
            </label>

            {status.error && <p className="form__error">{status.error}</p>}
            {status.message && <p className="form__success">{status.message}</p>}

            <div className="form__actions">
              <button type="submit" className="button" disabled={status.saving}>
                {status.saving ? "Saving..." : "Save Rubric"}
              </button>
              <Link className="button button--ghost" to="/">
                View User Workspace
              </Link>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
