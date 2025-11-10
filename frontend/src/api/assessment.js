import httpClient from "./httpClient";

export const fetchAssessment = () => httpClient.get("/assessment");

export const upsertAssessment = (formData) =>
  httpClient.post("/assessment", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
