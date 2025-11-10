import PropTypes from "prop-types";

export default function PromptEditor({
  promptForm,
  onPromptChange,
  onPromptSubmit,
  status,
  updatedAt,
  className,
}) {
  const formattedDate = updatedAt
    ? new Date(updatedAt).toLocaleString()
    : "Not updated yet";

  return (
    <section className={`panel panel--workspace ${className || ""}`.trim()}>
      <header className="panel__heading panel__heading--split">
        <div>
          <span className="panel__eyebrow">Prompt strategy</span>
          <h2 className="panel__title">AI grading instructions</h2>
        </div>
        <p className="panel__meta panel__meta--accent">
          Last updated: {formattedDate}
        </p>
      </header>

      <form className="form" onSubmit={onPromptSubmit}>
        <label className="form__label" htmlFor="promptInstructions">
          AI instructions
          <textarea
            id="promptInstructions"
            name="systemPrompt"
            className="form__textarea"
            rows={12}
            placeholder=""
            value={promptForm.systemPrompt}
            onChange={onPromptChange}
          />
        </label>

        {status.error && <p className="form__error">{status.error}</p>}
        {status.message && <p className="form__success">{status.message}</p>}

        <button className="button" type="submit" disabled={status.saving}>
          {status.saving ? "Saving..." : "Save prompt"}
        </button>
      </form>
    </section>
  );
}

PromptEditor.propTypes = {
  promptForm: PropTypes.shape({
    systemPrompt: PropTypes.string.isRequired,
  }).isRequired,
  onPromptChange: PropTypes.func.isRequired,
  onPromptSubmit: PropTypes.func.isRequired,
  status: PropTypes.shape({
    saving: PropTypes.bool.isRequired,
    message: PropTypes.string,
    error: PropTypes.string,
  }).isRequired,
  updatedAt: PropTypes.string,
  className: PropTypes.string,
};

PromptEditor.defaultProps = {
  updatedAt: undefined,
  className: "",
};
