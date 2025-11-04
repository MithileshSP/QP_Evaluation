import httpClient from "./httpClient";

export const login = (payload) => httpClient.post("/auth/login", payload);
export const register = (payload) => httpClient.post("/auth/register", payload);
