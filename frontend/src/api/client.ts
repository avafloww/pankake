import type { ValidateFunction } from "ajv";

import { codec, deviceListCodec } from "./contract";

export type Result<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "error"; readonly message: string };
export type Range = {
  readonly since: number;
  readonly until: number;
  readonly preset: number | null;
};

const services = codec("ServicesResponse");
const detail = codec("ServiceDetail");
const info = codec("DaemonInfoResponse");
const metrics = codec("MetricsResponse");
const restarts = codec("RestartsResponse");
const samples = codec("DeviceSamplesResponse");
const logs = codec("LogsResponse");
const config = codec("ConfigResponse");
const validation = codec("ConfigValidateResponse");

export const api = {
  services: (signal?: AbortSignal) =>
    request("/api/services", services, signal),
  detail: (name: string, signal?: AbortSignal) =>
    request(`/api/services/${encodeURIComponent(name)}`, detail, signal),
  devices: (signal?: AbortSignal) =>
    request("/api/devices", deviceListCodec, signal),
  info: (signal?: AbortSignal) => request("/api/info", info, signal),
  metrics: (range: Range, service?: string, signal?: AbortSignal) =>
    request(
      `/api/metrics?${query(range, { service, bucket: bucketSize(range).label })}`,
      metrics,
      signal,
    ),
  restarts: (range: Range, service?: string, signal?: AbortSignal) =>
    request(`/api/restarts?${query(range, { service })}`, restarts, signal),
  samples: (range: Range, signal?: AbortSignal) =>
    request(`/api/devices/samples?${query(range)}`, samples, signal),
  logs: (name: string, range: Range, before?: string, signal?: AbortSignal) =>
    request(
      `/api/services/${encodeURIComponent(name)}/logs?${query(range, { before, limit: "200" })}`,
      logs,
      signal,
    ),
  config: (signal?: AbortSignal) => request("/api/config", config, signal),
  validate: (content: string) =>
    request("/api/config/validate", validation, undefined, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }),
  save: async (content: string, hash: string): Promise<Result<void>> => {
    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: { "content-type": "text/plain", "if-match": `"${hash}"` },
        body: content,
      });
      if (response.status === 412)
        return {
          kind: "error",
          message:
            "Config: the file changed on the server. Reload it and review your edits before saving.",
        };
      return response.ok
        ? { kind: "ok", value: undefined }
        : { kind: "error", message: await failure(response) };
    } catch (error) {
      return { kind: "error", message: errorText(error) };
    }
  },
  action: async (
    name: string,
    action: "start" | "stop" | "restart" | "enable" | "disable",
  ): Promise<Result<void>> => {
    try {
      const response = await fetch(
        `/api/services/${encodeURIComponent(name)}/${action}`,
        { method: "POST" },
      );
      return response.ok
        ? { kind: "ok", value: undefined }
        : { kind: "error", message: await failure(response) };
    } catch (error) {
      return { kind: "error", message: errorText(error) };
    }
  },
};

export function bucketSize(range: Range) {
  const span = range.until - range.since;
  return span <= 3_600_000
    ? { label: "1m", ms: 60_000 }
    : span <= 86_400_000
      ? { label: "5m", ms: 300_000 }
      : { label: "1h", ms: 3_600_000 };
}

export function socketUrl(path: string) {
  const url = new URL(path, location.href);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function request<T>(
  url: string,
  validate: ValidateFunction<T>,
  signal?: AbortSignal,
  init?: RequestInit,
): Promise<Result<T>> {
  const result = await raw(url, { ...init, signal });
  if (result.kind === "error") return result;
  return validate(result.value)
    ? { kind: "ok", value: result.value }
    : {
        kind: "error",
        message: `${url.split("?")[0]}: the server returns an invalid response.`,
      };
}

async function raw(url: string, init: RequestInit): Promise<Result<unknown>> {
  try {
    const response = await fetch(url, init);
    return response.ok
      ? { kind: "ok", value: await response.json() }
      : { kind: "error", message: await failure(response) };
  } catch (error) {
    return { kind: "error", message: errorText(error) };
  }
}

export async function failure(response: Response) {
  const text = await response.text();
  try {
    const body: unknown = JSON.parse(text);
    if (body && typeof body === "object" && "error" in body) {
      const error = body.error;
      if (typeof error === "string") return error;
      if (
        error &&
        typeof error === "object" &&
        "message" in error &&
        typeof error.message === "string"
      )
        return error.message;
    }
  } catch {
    /* Non-JSON upstream failures still carry useful response text. */
  }
  return `${response.status}: ${text || response.statusText}`;
}

function query(range: Range, extra: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams({
    since: String(range.since),
    until: String(range.until),
  });
  for (const [key, value] of Object.entries(extra))
    if (value !== undefined) params.set(key, value);
  return params;
}
