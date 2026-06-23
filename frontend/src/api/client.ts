import { ApiError } from "../lib/types";

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api";

interface ClientConfig {
  getAccessToken: () => string | null;
  // Returns true if a refresh succeeded and the request should be retried.
  refreshAndRetry: () => Promise<boolean>;
}

let config: ClientConfig = {
  getAccessToken: () => null,
  refreshAndRetry: async () => false,
};

export function configureClient(next: ClientConfig): void {
  config = next;
}

interface FetchInit extends Omit<RequestInit, "body"> {
  body?: unknown;
}

async function doFetch(path: string, init: FetchInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  const token = config.getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let body: BodyInit | undefined;
  if (init.body !== undefined && init.body !== null) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.body);
  }

  return fetch(`${BASE_URL}${path}`, { ...init, headers, body });
}

async function toError(res: Response): Promise<ApiError> {
  let code = "http_error";
  let message = res.statusText || "Request failed";
  let details: unknown = null;
  try {
    const data = await res.json();
    if (data?.error) {
      code = data.error.code ?? code;
      message = data.error.message ?? message;
      details = data.error.details ?? null;
    }
  } catch {
    // non-JSON body — keep defaults
  }
  return new ApiError(res.status, code, message, details);
}

export async function apiFetch<T = unknown>(path: string, init: FetchInit = {}): Promise<T> {
  let res = await doFetch(path, init);

  if (res.status === 401) {
    const refreshed = await config.refreshAndRetry();
    if (refreshed) {
      res = await doFetch(path, init);
    }
  }

  if (!res.ok) {
    throw await toError(res);
  }

  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
