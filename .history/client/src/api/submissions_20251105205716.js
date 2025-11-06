import httpClient from "./httpClient";

export const uploadSubmission = (formData) =>
  httpClient.post("/submissions", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });

export const uploadBulkSubmissions = (formData) =>
  httpClient.post("/submissions/bulk", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });

export const fetchSubmissions = () => httpClient.get("/submissions");
