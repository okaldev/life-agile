// Small JSON API client. Every request carries the tab client id, so SSE echoes can be skipped.
import { toast } from "sonner";

export const CLIENT_ID = Math.random().toString(36).slice(2, 10);

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown, quiet = false): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      "x-client-id": CLIENT_ID,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 401) {
    window.location.href = "/giris";
    throw new ApiError(401, "unauthorized");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ApiError(res.status, (data as { error?: string }).error ?? res.statusText);
    if (!quiet) toast.error(`İşlem başarısız: ${err.message}`);
    throw err;
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
  quietPost: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body, true),
};
