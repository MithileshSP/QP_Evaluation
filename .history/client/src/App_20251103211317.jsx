import { useEffect, useMemo, useState } from "react";
import "./App.css";

import PromptEditor from "./components/PromptEditor";
import UploadForm from "./components/UploadForm";
import SubmissionsList from "./components/SubmissionsList";
import { fetchPrompt, updatePrompt } from "./api/prompt";
import { fetchSubmissions, uploadSubmission } from "./api/submissions";

function App() {
  const [loading, setLoading] = useState(true);
  const [promptForm, setPromptForm] = useState({ title: "", systemPrompt: "" });
  const [promptStatus, setPromptStatus] = useState({ saving: false, error: null, message: null });
  const [promptMeta, setPromptMeta] = useState({ updatedAt: null });

  const [uploadForm, setUploadForm] = useState({ subject: "", title: "", maxScore: "100" });
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadState, setUploadState] = useState({ uploading: false, error: null });

  const [submissions, setSubmissions] = useState([]);

  useEffect(() => {
    const loadWorkspace = async () => {
      try {
        const [promptResponse, submissionsResponse] = await Promise.all([
          fetchPrompt(),
          fetchSubmissions(),
        ]);

        const promptData = promptResponse.data || {};
        setPromptForm({
          title: promptData.title || "",
          systemPrompt: promptData.systemPrompt || "",
        });
        setPromptMeta({ updatedAt: promptData.updatedAt || null });
        setSubmissions(submissionsResponse.data || []);
      } catch (error) {
        console.error("error: unable to load workspace", error);
        setPromptStatus((prev) => ({ ...prev, error: "Failed to load prompt" }));
        setUploadState((prev) => ({ ...prev, error: "Failed to load submissions" }));
      } finally {
        setLoading(false);
      }
    };

    loadWorkspace();
  }, []);

  const latestSubmission = useMemo(() => submissions[0] || null, [submissions]);

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
      setPromptStatus({ saving: false, error: null, message: "Prompt updated" });
    } catch (error) {
      const message = error?.response?.data?.error || "Unable to update prompt";
      setPromptStatus({ saving: false, error: message, message: null });
    }
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);
  };

  const handleSubmission = async (event) => {
    event.preventDefault();

    if (!selectedFile) {
      setUploadState({ uploading: false, error: "Please attach an image or PDF" });
      return;
    }

    setUploadState({ uploading: true, error: null });

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("title", uploadForm.title || selectedFile.name);
      formData.append("maxScore", uploadForm.maxScore);

      const { data } = await uploadSubmission(formData);
      setSubmissions((prev) => [data, ...prev]);
      setUploadForm((prev) => ({ ...prev, title: "", subject: "", maxScore: prev.maxScore }));
      setSelectedFile(null);
      event.currentTarget.reset();
      setUploadState({ uploading: false, error: null });
    } catch (error) {
      const message = error?.response?.data?.error || "Upload failed";
      setUploadState({ uploading: false, error: message });
    }
  };

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">AI Grading Workspace</h1>
        <p className="app__subtitle">
          Configure your prompt, upload answer sheets, and receive AI-generated scores with detailed
          reasoning in seconds.
        </p>
      </header>

      <div className="app__layout">
        <PromptEditor
          promptForm={promptForm}
          onPromptChange={handlePromptChange}
          onPromptSubmit={handlePromptSubmit}
          status={promptStatus}
          updatedAt={promptMeta.updatedAt}
        />

        <UploadForm
          form={uploadForm}
          setForm={setUploadForm}
          selectedFile={selectedFile}
          onFileChange={handleFileChange}
          onSubmit={handleSubmission}
          state={uploadState}
        />

        <SubmissionsList submissions={submissions} loading={loading && !latestSubmission} />
      </div>
    </div>
  );
}

export default App;
