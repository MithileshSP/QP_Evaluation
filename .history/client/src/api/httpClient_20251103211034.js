import axios from "axios";

const baseURL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";

const httpClient = axios.create({
  baseURL,
  timeout: 30000,
});

export default httpClient;
