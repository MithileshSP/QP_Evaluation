import axios from "axios";

const baseURL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";

const configuredTimeout = Number(import.meta.env.VITE_API_TIMEOUT_MS);
const timeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0
  ? configuredTimeout
  : 120000;

const httpClient = axios.create({
  baseURL,
  timeout,
  timeoutErrorMessage:
    "Request timed out before the server finished processing. Please try again.",
});

export default httpClient;
