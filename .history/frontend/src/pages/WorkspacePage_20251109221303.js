import { useState, useMemo } from "react";
import PromptEditor from "../components/PromptEditor";
import AssessmentManager from "../components/AssessmentManager";
import UploadForm from "../components/UploadForm";
import BulkBatchSummary from "../components/BulkBatchSummary";
import EvaluationHighlight from "../components/EvaluationHighlight";
import { updatePrompt } from "../api/prompt";
import { uploadBulkSubmissions, uploadSubmission } from "../api/submissions";
import { createBulkBatch } from "../api/bulkBatches";

function WorkspacePage({
  assessment,
  onAssessmentSaved,
  submissions,
  onSubmissionsUpdate,
  promptForm,
  setPromptForm,
  promptMeta,
  setPromptMeta,
  loading,
  onViewSwitch,
  bulkBatches,
  setBulkBatches,
}) {
  const [promptStatus, setPromptStatus] = useState({
    saving: false,
    error: null,
    message: null,
  });

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
    bundleUrl: null,
    message: null,
  });
  // Removed: const [bulkBatches, setBulkBatches] = useState([]);
  // Now using bulkBatches from props

  const latestSubmission = useMemo(() => submissions[0] || null, [submissions]);
  const historySubmissions = useMemo(
    () => (submissions.length > 1 ? submissions.slice(1) : []),
    [submissions]
  );

  // Check if latest submission is part of a bulk batch (hide highlight for bulk)
  const isLatestFromBulk = useMemo(() => {
    if (!latestSubmission) return false;
    return bulkBatches.some((batch) =>
      batch.submissions.some(
        (sub) =>
          sub.id === latestSubmission.id || sub._id === latestSubmission._id
      )
    );
  }, [latestSubmission, bulkBatches]);

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

  const handleSubmission = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const hasAssessmentAssets =
      assessment && assessment.questionPaper && assessment.answerKey;
    const isBulk = uploadForm.mode === "bulk";

    if (!hasAssessmentAssets) {
      setUploadState({
        uploading: false,
        error: "Upload the question paper and answer key before grading.",
        bundleUrl: null,
        message: null,
      });
      return;
    }

    if (!isBulk) {
      const file = selectedFiles[0];
      if (!file) {
        setUploadState({
          uploading: false,
          error: "Please attach an image or PDF",
          bundleUrl: null,
          message: null,
        });
        return;
      }
    } else if (selectedFiles.length === 0) {
      setUploadState({
        uploading: false,
        error: "Select at least one answer script to grade.",
        bundleUrl: null,
        message: null,
      });
      return;
    }

    setUploadState({
      uploading: true,
      error: null,
      message: null,
      bundleUrl: null,
    });

    try {
      const formData = new FormData();
      const trimmedTitle = uploadForm.title?.trim() || "";
      const trimmedPrefix = uploadForm.titlePrefix?.trim() || "";

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

      if (!isBulk) {
        const file = selectedFiles[0];
        const derivedTitle =
          trimmedTitle || `${assessment.title || "Submission"} – ${file.name}`;
        formData.append("file", file);
        formData.append("title", derivedTitle);

        const { data } = await uploadSubmission(formData);
        onSubmissionsUpdate((prev) => [data, ...prev]);
        setUploadForm((prev) => ({ ...prev, title: "" }));
        setSelectedFiles([]);
        setFileInputKey(Date.now());
        if (formElement) {
          formElement.reset();
        }
        setUploadState({
          uploading: false,
          error: null,
          bundleUrl: null,
          message: "Submission evaluated successfully.",
        });
        return;
      }

      selectedFiles.forEach((file) => {
        formData.append("files", file);
      });
      if (trimmedPrefix) {
        formData.append("titlePrefix", trimmedPrefix);
      }

      const { data } = await uploadBulkSubmissions(formData);
      const created = Array.isArray(data?.submissions) ? data.submissions : [];
      const failures = Array.isArray(data?.errors) ? data.errors : [];
      const bundleUrl =
        typeof data?.bundleDownloadUrl === "string"
          ? data.bundleDownloadUrl
          : null;

      if (created.length > 0) {
        onSubmissionsUpdate((prev) => [...created, ...prev]);

        const batchTitle =
          trimmedPrefix || assessment?.title || "Bulk evaluation";
        const batchDescription = assessment?.title
          ? `Evaluated answer scripts against ${assessment.title}.`
          : "Batch evaluation completed.";

        // Create bulk batch in backend
        try {
          const batchPayload = {
            title: batchTitle,
            description: batchDescription,
            bundleUrl: bundleUrl || "",
            assessmentId: assessment?.id || "",
            submissionIds: created.map((sub) => sub.id || sub._id),
          };

          const { data: savedBatch } = await createBulkBatch(batchPayload);

          // Add the saved batch with populated submissions to state
          setBulkBatches((prev) => [
            {
              id: savedBatch.id || savedBatch._id,
              title: savedBatch.title,
              description: savedBatch.description,
              bundleUrl: savedBatch.bundleUrl,
              createdAt: savedBatch.createdAt,
              submissions: savedBatch.submissions || created,
            },
            ...prev,
          ]);
        } catch (batchError) {
          console.error("Failed to create bulk batch in backend:", batchError);
          // Fallback to frontend-only batch if backend fails
          const batchId = `batch-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`;
          const batchCreatedAt =
            created[0]?.createdAt || new Date().toISOString();

          setBulkBatches((prev) => [
            {
              id: batchId,
              title: batchTitle,
              description: batchDescription,
              bundleUrl,
              createdAt: batchCreatedAt,
              submissions: created,
            },
            ...prev,
          ]);
        }
      }

      setUploadForm((prev) => ({ ...prev, title: "" }));
      setSelectedFiles([]);
      setFileInputKey(Date.now());
      if (formElement) {
        formElement.reset();
      }

      if (failures.length > 0 && created.length === 0) {
        setUploadState({
          uploading: false,
          error: `${failures.length} file${
            failures.length === 1 ? "" : "s"
          } could not be evaluated.`,
          bundleUrl,
          message: null,
        });
        return;
      }

      const successMessage =
        created.length > 0
          ? `Evaluated ${created.length} submission${
              created.length === 1 ? "" : "s"
            }.`
          : null;
      const errorMessage =
        failures.length > 0
          ? `${failures.length} upload${
              failures.length === 1 ? "" : "s"
            } failed; please retry those files.`
          : null;

      setUploadState({
        uploading: false,
        error: errorMessage,
        bundleUrl,
        message: successMessage,
      });
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
      setUploadState({
        uploading: false,
        error: message,
        bundleUrl: null,
        message: null,
      });
    }
  };

  return (
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
        onSaved={onAssessmentSaved}
        className="panel--span-12 panel--lg-span-5"
      />

      <UploadForm
        assessment={assessment}
        form={uploadForm}
        setForm={setUploadForm}
        selectedFiles={selectedFiles}
        fileInputKey={fileInputKey}
        onFileChange={handleFileChange}
        onSubmit={handleSubmission}
        state={uploadState}
        className="panel--span-12"
      />

      {bulkBatches.map((batch) => (
        <BulkBatchSummary
          key={batch.id}
          batch={batch}
          onClear={() =>
            setBulkBatches((prev) =>
              prev.filter((item) => item.id !== batch.id)
            )
          }
          className="panel--span-12"
        />
      ))}

      {!isLatestFromBulk && latestSubmission && (
        <EvaluationHighlight
          submission={latestSubmission}
          loading={loading && !latestSubmission}
          historyCount={historySubmissions.length}
          onViewHistory={() => onViewSwitch("history")}
          className="panel--span-12 panel--spotlight"
        />
      )}
    </div>
  );
}

export default WorkspacePage;
