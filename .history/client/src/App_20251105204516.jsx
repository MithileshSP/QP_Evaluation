import { useEffect, useMemo, useState } from "react";
import "./App.css";

import PromptEditor from "./components/PromptEditor";
import AssessmentManager from "./components/AssessmentManager";
import UploadForm from "./components/UploadForm";
import SubmissionsList from "./components/SubmissionsList";
import EvaluationHighlight from "./components/EvaluationHighlight";
import { fetchAssessment } from "./api/assessment";
import { fetchPrompt, updatePrompt } from "./api/prompt";
import {
  fetchSubmissions,
  uploadBulkSubmissions,
  uploadSubmission,
} from "./api/submissions";

function App() {
  const [loading, setLoading] = useState(true);
  const [promptForm, setPromptForm] = useState({ title: "", systemPrompt: "" });
  const [promptStatus, setPromptStatus] = useState({
    saving: false,
    error: null,
    message: null,
  });
  const [promptMeta, setPromptMeta] = useState({ updatedAt: null });
  const [assessment, setAssessment] = useState(null);

  const [uploadForm, setUploadForm] = useState({
    mode: "single",
    title: "",
    titlePrefix: "",
  });
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [fileInputKey, setFileInputKey] = useState(() => Date.now());
  const [uploadState, setUploadState] = useState({
    uploading: false,
    error: null,
    message: null,
  });

  const [submissions, setSubmissions] = useState([]);
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
        setPromptStatus((prev) => ({
          ...prev,
          error: "Failed to load prompt",
        }));
      }

      if (submissionsResult.status === "fulfilled") {
        setSubmissions(submissionsResult.value?.data || []);
      } else {
        console.error(
          "error: unable to load submissions",
          submissionsResult.reason
        );
        setUploadState((prev) => ({
          ...prev,
          error: "Failed to load submissions",
        }));
      }

      setLoading(false);
    };

    loadWorkspace();
  }, []);

  useEffect(() => {
    setSelectedFiles([]);
    setFileInputKey(Date.now());
    setUploadState((prev) => ({ ...prev, error: null, message: null }));
  }, [uploadForm.mode]);

  const latestSubmission = useMemo(() => submissions[0] || null, [submissions]);
  const historySubmissions = useMemo(
    () => (submissions.length > 1 ? submissions.slice(1) : []),
    [submissions]
  );

  const handlePromptChange = (event) => {
    const { name, value } = event.target;
    setPromptForm((prev) => ({ ...prev, [name]: value }));
    setPromptStatus({ saving: false, error: null, message: null });
  };

  const handlePromptSubmit = async (event) => {
    event.preventDefault();
    setPromptStatus({ saving: true, error: null, message: null });
    try {
      const { data } = await updatePrompt(promptForm);
      setPromptForm({
        title: data.title || "",
        systemPrompt: data.systemPrompt || "",
      });
      setPromptMeta({ updatedAt: data.updatedAt || new Date().toISOString() });
      setPromptStatus({
        saving: false,
        error: null,
        message: "Prompt updated",
      });
    } catch (error) {
      const message = error?.response?.data?.error || "Unable to update prompt";
      setPromptStatus({ saving: false, error: message, message: null });
    }
  };

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files || []);
    const isBulk = uploadForm.mode === "bulk";
    setSelectedFiles(isBulk ? files : files.slice(0, 1));
    setUploadState((prev) => ({ ...prev, error: null, message: null }));
  };

  const handleAssessmentSaved = (data) => {
    setAssessment(data || null);
    setUploadState((prev) => ({ ...prev, error: null }));
  };

  const handleSubmission = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;

    if (!selectedFile) {
      setUploadState({
        uploading: false,
        error: "Please attach an image or PDF",
      });
      return;
    }

    if (!assessment || !assessment.questionPaper || !assessment.answerKey) {
      setUploadState({
        uploading: false,
        error: "Upload the question paper and answer key before grading.",
      });
      return;
    }

    setUploadState({ uploading: true, error: null });

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      const derivedTitle =
        uploadForm.title?.trim() ||
        `${assessment.title || "Submission"} – ${selectedFile.name}`;
      formData.append("title", derivedTitle);

      if (assessment.id) {
        formData.append("assessmentId", assessment.id);
      }
      if (assessment.subject) {
        formData.append("subject", assessment.subject);
      }
      if (assessment.grade) {
        formData.append("grade", assessment.grade);
      }
      if (assessment.maxScore) {
        formData.append("maxScore", String(assessment.maxScore));
      }

      const { data } = await uploadSubmission(formData);
      setSubmissions((prev) => [data, ...prev]);
      setUploadForm({
        title: "",
      });
      setSelectedFile(null);
      setFileInputKey(Date.now());
      if (formElement) {
        formElement.reset();
      }
      setUploadState({ uploading: false, error: null });
    } catch (error) {
      const payload = error?.response?.data;
      console.error("upload error", error);
      const status = error?.response?.status;
      const parts = [
        status ? `HTTP ${status}` : null,
        payload?.error,
        payload?.details,
        payload?.hint,
      ].filter(Boolean);
      const retryAfter = payload?.retryAfterSeconds;
      if (retryAfter) {
        parts.push(`Try again after ~${retryAfter} seconds.`);
      }
      const message = parts.join(" — ") || error?.message || "Upload failed";
      setUploadState({ uploading: false, error: message });
    }
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
        <div className="app__layout">
          <PromptEditor
            promptForm={promptForm}
            onPromptChange={handlePromptChange}
            onPromptSubmit={handlePromptSubmit}
            status={promptStatus}
            updatedAt={promptMeta.updatedAt}
            className="panel--span-12 panel--lg-span-7"
          />

          <AssessmentManager
            assessment={assessment}
            onSaved={handleAssessmentSaved}
            className="panel--span-12 panel--lg-span-5"
          />

          <UploadForm
            assessment={assessment}
            form={uploadForm}
            setForm={setUploadForm}
            selectedFile={selectedFile}
            fileInputKey={fileInputKey}
            onFileChange={handleFileChange}
            onSubmit={handleSubmission}
            state={uploadState}
            className="panel--span-12"
          />

          <EvaluationHighlight
            submission={latestSubmission}
            loading={loading && !latestSubmission}
            historyCount={historySubmissions.length}
            onViewHistory={() => handleViewSwitch("history")}
            className="panel--span-12 panel--spotlight"
          />
        </div>
      ) : (
        <div className="app__layout app__layout--single">
          <SubmissionsList
            submissions={historySubmissions}
            loading={loading && !latestSubmission}
            title="Evaluation history"
            metaFormatter={({ count }) =>
              count === 0
                ? "No archived evaluations yet."
                : `Showing ${count} archived record${count === 1 ? "" : "s"}.`
            }
            emptyStateMessage="Run more evaluations to build up your archive. Each completed submission will appear here."
            className="panel--span-12 panel--history"
            eyebrow="Archive overview"
          />
        </div>
      )}
    </div>
  );
}

export default App;
