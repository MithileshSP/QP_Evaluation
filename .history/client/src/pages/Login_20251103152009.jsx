import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { user, login, isLoading, error } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", password: "" });
  const [localError, setLocalError] = useState(null);

  useEffect(() => {
    if (user) {
      navigate(user.role === "admin" ? "/admin" : "/", { replace: true });
    }
  }, [user, navigate]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLocalError(null);
    if (!form.username || !form.password) {
      setLocalError("Username and password are required");
      return;
    }
    const result = await login(form);
    if (!result.success) {
      setLocalError(result.message || "Unable to login");
    }
  };

  return (
    <div className="page page--centered">
      <div className="card card--narrow">
        <h1 className="title">Login</h1>
        <p className="subtitle">Sign in to access the grading workspace.</p>
        <form onSubmit={handleSubmit} className="form">
          <label className="form__label" htmlFor="username">
            Username
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              value={form.username}
              onChange={handleChange}
              className="form__input"
              placeholder="Enter username"
            />
          </label>

          <label className="form__label" htmlFor="password">
            Password
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={handleChange}
              className="form__input"
              placeholder="Enter password"
            />
          </label>

          {(localError || error) && (
            <p className="form__error">{localError || error}</p>
          )}

          <button type="submit" className="button" disabled={isLoading}>
            {isLoading ? "Signing in..." : "Sign In"}
          </button>
        </form>
        <p className="hint">
          Need an account? Ask an admin to create one in the backend.
        </p>
      </div>
    </div>
  );
}
