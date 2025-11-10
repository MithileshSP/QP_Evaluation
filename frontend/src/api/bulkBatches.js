import httpClient from "./httpClient";

export async function fetchBulkBatches() {
  return httpClient.get("/bulk-batches");
}

export async function fetchGroupedBulkBatches() {
  return httpClient.get("/bulk-batches/grouped");
}

export async function createBulkBatch(data) {
  return httpClient.post("/bulk-batches", data);
}

export async function getBulkBatch(id) {
  return httpClient.get(`/bulk-batches/${id}`);
}

export async function deleteBulkBatch(id) {
  return httpClient.delete(`/bulk-batches/${id}`);
}
