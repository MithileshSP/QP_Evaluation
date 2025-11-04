import httpClient from "./httpClient";

export const fetchPrompt = () => httpClient.get("/prompt");
export const updatePrompt = (payload) => httpClient.put("/prompt", payload);
