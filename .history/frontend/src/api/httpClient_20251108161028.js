import axios from "axios";

const baseURL =
  process.env.REACT_APP_API_BASE_URL || "http://localhost:8080/api";

const configuredTimeout = Number(process.env.REACT_APP_API_TIMEOUT_MS);
const timeout =
  Number.isFinite(configuredTimeout) && configuredTimeout >= 0
    ? configuredTimeout
    : 0;

const httpClient = axios.create({
  baseURL,
  timeout,
  timeoutErrorMessage:
    "Request timed out before the server finished processing. Please try again.",
});

export default httpClient;
