import { useEffect, useState } from "react";
import "./App.css";

import WorkspacePage from "./pages/WorkspacePage";
import HistoryPage from "./pages/HistoryPage";
import { fetchAssessment } from "./api/assessment";
import { fetchPrompt } from "./api/prompt";
import { fetchSubmissions } from "./api/submissions";

function App() {
  const [loading, setLoading] = useState(true);
  const [promptForm, setPromptForm] = useState({ title: "", systemPrompt: "" });
  const [promptMeta, setPromptMeta] = useState({ updatedAt: null });
  const [assessment, setAssessment] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [bulkBatches, setBulkBatches] = useState([]);
  const [activeView, setActiveView] = useState("workspace");

  useEffect(() => {
    const loadWorkspace = async () => {
      const [assessmentResult, promptResult, submissionsResult] =
        await Promise.allSettled([
          fetchAssessment(),
          fetchPrompt(),
          fetchSubmissions(),
        ]);

      if (assessmentResult.status === "fulfilled") {
        setAssessment(assessmentResult.value?.data || null);
      } else {
        console.error(
          "error: unable to load assessment",
          assessmentResult.reason
        );
        setAssessment(null);
      }

      if (promptResult.status === "fulfilled") {
        const promptData = promptResult.value?.data || {};
        setPromptForm({
          title: promptData.title || "",
          systemPrompt: promptData.systemPrompt || "",
        });
        setPromptMeta({ updatedAt: promptData.updatedAt || null });
      } else {
        console.error("error: unable to load prompt", promptResult.reason);
      }

      if (submissionsResult.status === "fulfilled") {
        setSubmissions(submissionsResult.value?.data || []);
      } else {
        console.error(
          "error: unable to load submissions",
          submissionsResult.reason
        );
      }

      setLoading(false);
    };

    loadWorkspace();
  }, []);

  const handleAssessmentSaved = (data) => {
    setAssessment(data || null);
  };

  const handleViewSwitch = (view) => {
    setActiveView(view);
  };

  const isWorkspaceView = activeView === "workspace";

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">AI Grading Workspace</h1>
        <p className="app__subtitle">
          Configure your prompt, upload answer sheets, and receive AI-generated
          scores with detailed reasoning in seconds.
        </p>

        <nav className="app__nav" aria-label="Primary navigation">
          <button
            type="button"
            className={`app__nav-button${
              isWorkspaceView ? " app__nav-button--active" : ""
            }`}
            onClick={() => handleViewSwitch("workspace")}
          >
            Workspace
          </button>
          <button
            type="button"
            className={`app__nav-button${
              !isWorkspaceView ? " app__nav-button--active" : ""
            }`}
            onClick={() => handleViewSwitch("history")}
          >
            History
          </button>
        </nav>
      </header>

      {isWorkspaceView ? (
        <WorkspacePage
          assessment={assessment}
          onAssessmentSaved={handleAssessmentSaved}
          submissions={submissions}
          onSubmissionsUpdate={setSubmissions}
          promptForm={promptForm}
          setPromptForm={setPromptForm}
          promptMeta={promptMeta}
          setPromptMeta={setPromptMeta}
          loading={loading}
          onViewSwitch={handleViewSwitch}
        />
      ) : (
        <HistoryPage submissions={submissions} loading={loading} />
      )}
    </div>
  );
}

export default App;
