import type { Page } from "@playwright/test";

import type {
  Bucket,
  Detail,
  Device,
  Schemas,
  Service,
} from "../src/api/contract";
import rows from "./reference-services.json" with { type: "json" };

const GiB = 1024 ** 3;
const bytes = (gib: number) => Math.round(gib * GiB);

export const referenceServices: Service[] = rows.map((row) => ({
  name: row.name,
  state: row.state,
  port: row.port,
  openai_compat: !row.embedding,
  lifecycle: "ondemand",
  priority: 80,
  pid: null,
  run_id: null,
  elastic_borrower: null,
  has_mmproj: row.vision,
  modality: row.embedding ? "embedding" : "chat",
  footprint_bytes: bytes(row.gib),
  footprint_devices: [
    { device: "cpu", bytes: bytes(Math.min(0.81, row.gib * 0.15)) },
    {
      device: "gpu:0",
      bytes: bytes((row.gib - Math.min(0.81, row.gib * 0.15)) / 2),
    },
    {
      device: "gpu:1",
      bytes: bytes((row.gib - Math.min(0.81, row.gib * 0.15)) / 2),
    },
  ],
  inflight_count: 0,
  last_used_ms: row.state === "running" ? Date.now() : null,
}));

export function hardware(count: number): Device[] {
  return [
    ...Array.from({ length: count }, (_, index) => ({
      id: `gpu:${index}`,
      name: "NVIDIA GeForce RTX 3090",
      total_bytes: 24 * GiB,
      free_bytes: bytes(index === 0 ? 24 - 19.9 * 0.55 : 24 - 18.75 * 0.92),
      reservations: [
        {
          service: "qwen3.6-27b",
          bytes: bytes(index === 0 ? 20.56 : 19.7),
          elastic: false,
        },
      ],
    })),
    {
      id: "cpu",
      name: "AMD Ryzen 9 7950X",
      total_bytes: bytes(125.67),
      free_bytes: bytes(125.67 - 45.93),
      reservations: [
        { service: "qwen3.6-27b", bytes: bytes(0.81), elastic: false },
      ],
    },
  ];
}

export function serviceDetail(name: string): Detail {
  const service =
    referenceServices.find((s) => s.name === name) ?? referenceServices[0];
  return {
    name,
    template: "llama-cpp",
    state: service.state,
    lifecycle: service.lifecycle,
    priority: service.priority,
    port: service.port,
    private_port: service.port + 30_000,
    placement_override: {},
    idle_timeout_ms: 600_000,
    pid: null,
    run_id: null,
    recent_logs: [],
    rolling_mean: null,
    rolling_samples: 0,
    rolling_mean_host: null,
    rolling_samples_host: 0,
    observed_peak_bytes: 0,
    elastic_borrower: null,
    model_info: null,
    estimate: {
      weights_bytes: bytes(17.25),
      kv_per_token: 0,
      configured_context: 204800,
      kv_bytes_for_context: bytes(16.43),
      compute_buffer_bytes_per_device: bytes(3.29),
    },
    placement_preview: {
      verdict: { kind: "fits" },
      expert_offload_bytes: 0,
      expert_offload_layers: 0,
      devices: (service.footprint_devices ?? []).map((p) => ({
        device: p.device,
        bytes: p.bytes,
        max_bytes: p.bytes,
        used_by_others_bytes: (p.device === "cpu" ? 45 : 10) * GiB,
        total_bytes: p.device === "cpu" ? bytes(125.67) : 24 * GiB,
      })),
    },
    current_allocation: {},
    modality: service.modality,
  };
}

export async function mockBackend(page: Page, count = 2) {
  let state = "running",
    content =
      '# Test configuration\n[daemon]\nmanagement_listen = "127.0.0.1:7071"\n',
    hash = "initial";
  const calls: {
    readonly method: string;
    readonly url: string;
    readonly body: string | null;
  }[] = [];
  await page.routeWebSocket("**/api/events", (socket) => {
    socket.onMessage(() => {});
  });
  await page.routeWebSocket("**/api/services/*/logs/stream", (socket) => {
    socket.onMessage(() => {});
  });
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      calls.push({
        method: request.method(),
        url: url.pathname + url.search,
        body: request.postData(),
      });
      const ok = (json: unknown) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(json),
        });
      if (url.pathname === "/api/services")
        return ok({
          services: referenceServices.map((s) =>
            s.name === "qwen3.6-27b" ? { ...s, state } : s,
          ),
          openai_api_port: 7070,
        });
      if (url.pathname === "/api/devices") return ok(hardware(count));
      if (url.pathname === "/api/info")
        return ok({
          openai_listen: "127.0.0.1:7070",
          management_listen: "127.0.0.1:7071",
          uptime_ms: 6 * 86_400_000 + 4 * 3_600_000,
          config_path: "~/.config/ananke/config.toml",
        });
      if (url.pathname === "/api/config" && request.method() === "PUT") {
        if (request.headers()["if-match"] !== `"${hash}"`)
          return route.fulfill({ status: 412, body: "changed" });
        content = request.postData() ?? content;
        hash = "saved";
        return route.fulfill({ status: 202 });
      }
      if (url.pathname === "/api/config")
        return ok({ content, hash, writable: true });
      if (url.pathname === "/api/config/validate")
        return ok({
          valid: !request.postData()?.includes("invalid"),
          errors: request.postData()?.includes("invalid")
            ? [{ line: 1, column: 1, message: "Invalid TOML." }]
            : [],
        });
      if (url.pathname === "/api/restarts") return ok({ restarts: [] });
      if (url.pathname === "/api/devices/samples") return ok({ samples: [] });
      if (url.pathname === "/api/metrics") {
        const since = Number(url.searchParams.get("since"));
        const bucket: Bucket = {
          service: url.searchParams.get("service") ?? "qwen3.6-27b",
          bucket_start: Math.ceil(since / 300_000) * 300_000,
          request_count: 10,
          prompt_tokens: 100,
          completion_tokens: 200,
          avg_duration_ms: 4506,
          error_count: 1,
          avg_ttft_ms: 200,
          output_tps: 57.4,
          input_tps: 312.9,
          effective_tps: 44.3,
        };
        return ok({ buckets: [bucket] });
      }
      const name = decodeURIComponent(url.pathname.split("/")[3] ?? "");
      if (url.pathname.endsWith("/logs"))
        return ok({
          logs: [
            {
              timestamp_ms: Date.now() - 1000,
              stream: "stdout",
              line: "server is listening",
              run_id: 1,
              seq: 1,
            },
          ],
          next_cursor: null,
        });
      const action = url.pathname.split("/")[4];
      if (action && request.method() === "POST") {
        state =
          action === "disable"
            ? "disabled_user_disabled"
            : action === "stop" || action === "enable"
              ? "idle"
              : "running";
        return ok({});
      }
      if (name)
        return ok({
          ...serviceDetail(name),
          state: name === "qwen3.6-27b" ? state : serviceDetail(name).state,
        });
      return route.fulfill({ status: 404 });
    },
  );
  await page.route("**/v1/**", async (route) => {
    if (route.request().url().endsWith("/models"))
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          object: "list",
          data: referenceServices
            .filter((s) => s.modality === "chat")
            .map((s) => ({
              id: s.name,
              object: "model",
              created: 0,
              owned_by: "ananke",
            })),
        }),
      });
    const chunks: Schemas["ChatCompletionChunk"][] = [
      {
        choices: [
          {
            delta: { reasoning_content: "Consider the request.\nThen answer." },
          },
        ],
      },
      {
        choices: [
          { delta: { content: "Hello.\n\n```rust\nfn main() {}\n```" } },
        ],
      },
      {
        usage: { prompt_tokens: 12, completion_tokens: 5 },
        timings: { predicted_ms: 1000 },
      },
    ];
    calls.push({
      method: route.request().method(),
      url: "/v1/chat/completions",
      body: route.request().postData(),
    });
    return route.fulfill({
      contentType: "text/event-stream",
      body:
        chunks.map((c) => `data: ${JSON.stringify(c)}\r\n\r\n`).join("") +
        "data: [DONE]\r\n\r\n",
    });
  });
  return calls;
}
