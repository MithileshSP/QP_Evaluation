import PropTypes from "prop-types";

const SUBJECT_PRESETS = [
  {
    value: "",
    label: "Custom prompt",
    prompt:
      "You are an experienced examiner. Analyse the provided answer script and award marks fairly. Always respond with a JSON object containing score, maxScore, and reasoning.",
  },
  {
    value: "physics",
    label: "Physics (CBSE)",
    prompt:
      "You are a CBSE Physics teacher grading a 10th grade exam. Award marks conservatively based on correctness, units, diagrams, and clarity. Respond with JSON {score, maxScore, reasoning} and cite question numbers for deductions.",
  },
  {
    value: "chemistry",
    label: "Chemistry (CBSE)",
    prompt:
      "You are a CBSE Chemistry teacher evaluating a written paper. Reward balanced chemical equations, correct terminology, and relevant explanations. Respond with JSON {score, maxScore, reasoning}.",
  },
  {
    value: "math",
    label: "Mathematics (CBSE)",
    prompt:
      "You are a CBSE Mathematics examiner. Allocate marks for correct steps, final answers, and working notes. Penalise missing reasoning. Return JSON {score, maxScore, reasoning} detailing deductions by question.",
  },
];

export default function PromptEditor({
  promptForm,
  onPromptChange,
  onPromptSubmit,
  status,
  updatedAt,
}) {
  const formattedDate = updatedAt
    ? new Date(updatedAt).toLocaleString()
    : "Not updated yet";

  const handlePresetChange = (event) => {
    const selected = SUBJECT_PRESETS.find((option) => option.value === event.target.value);
    if (!selected) {
      return;
    }
    onPromptChange({
      target: {
        name: "systemPrompt",
        value: selected.prompt,
      },
    });
    if (selected.value) {
      onPromptChange({
        target: {
          name: "title",
          value: `${selected.label} Grading Prompt`,
        },
      });
    }
  };

  return (
    <section className="panel">
      <header className="panel__heading">
        <h2 className="panel__title">Configure Grading Prompt</h2>
        <p className="panel__meta">Last updated: {formattedDate}</p>
      </header>

  <form className="form" onSubmit={onPromptSubmit}>
        <label className="form__label" htmlFor="promptTitle">
          Prompt title
          <input
            id="promptTitle"
            name="title"
            className="form__input"
            type="text"
            placeholder="e.g. Physics Unit Test Rubric"
            value={promptForm.title}
            onChange={onPromptChange}
            required
          />
        </label>

        <label className="form__label" htmlFor="promptPreset">
          Quick subject template
          <select
            id="promptPreset"
            name="promptPreset"
            className="form__select"
            defaultValue=""
            onChange={handlePresetChange}
          >
            {SUBJECT_PRESETS.map((preset) => (
              <option key={preset.value || "custom"} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </select>
          <p className="form__hint">Selecting a template will replace the AI instructions. You can tweak them afterwards.</p>
        </label>

        <label className="form__label" htmlFor="promptInstructions">
          AI instructions
          <textarea
            id="promptInstructions"
            name="systemPrompt"
            className="form__textarea"
            rows={12}
            placeholder="Describe how marks should be awarded..."
            value={promptForm.systemPrompt}
            onChange={onPromptChange}
            required
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
    title: PropTypes.string.isRequired,
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
};
