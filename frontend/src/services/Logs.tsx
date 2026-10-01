import { useEffect, useRef, useState } from "preact/hooks";

import type { Range } from "../api/client";
import { api, socketUrl } from "../api/client";
import { logCodec } from "../api/contract";
import type { LogLine } from "../api/contract";
import { Copy } from "../ui/Copy";
import { Message } from "../ui/Message";
import { time } from "../ui/format";

export function Logs({
  name,
  range,
  running,
}: {
  readonly name: string;
  readonly range: Range;
  readonly running: boolean;
}) {
  const [lines, setLines] = useState<readonly LogLine[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState<string>(),
    [loading, setLoading] = useState(true),
    [streaming, setStreaming] = useState(false);
  const ref = useRef<HTMLDivElement>(null),
    busyRef = useRef(false),
    cursorRef = useRef<string | null>(null),
    generationRef = useRef(0);
  const live = range.preset !== null;
  const since = live ? 0 : range.since,
    until = live ? 0 : range.until,
    preset = range.preset;
  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);
  useEffect(() => {
    const controller = new AbortController();
    const run = ++generationRef.current;
    let socket: WebSocket | undefined, timer: ReturnType<typeof setTimeout>;
    setLines([]);
    setCursor(null);
    setLoading(true);
    setError(undefined);
    busyRef.current = false;
    const currentRange = () => {
      const now = Date.now();
      return preset
        ? { preset, since: now - preset * 3_600_000, until: now }
        : { preset: null, since, until };
    };
    async function load() {
      const result = await api.logs(
        name,
        currentRange(),
        undefined,
        controller.signal,
      );
      if (controller.signal.aborted || run !== generationRef.current) return;
      setLoading(false);
      if (result.kind === "error") {
        setError(result.message);
        return;
      }
      setLines((previous) => mergeLogs(previous, result.value.logs));
      setCursor(result.value.next_cursor ?? null);
      requestAnimationFrame(() => {
        if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
      });
    }
    function connect() {
      socket = new WebSocket(
        socketUrl(`/api/services/${encodeURIComponent(name)}/logs/stream`),
      );
      socket.onopen = () => {
        setStreaming(true);
        void load();
      };
      socket.onclose = () => {
        setStreaming(false);
        if (!controller.signal.aborted) timer = setTimeout(connect, 2000);
      };
      socket.onmessage = (message) => {
        try {
          const value: unknown = JSON.parse(message.data);
          if (!logCodec(value)) return;
          if (value.type === "overflow") {
            setError(
              `${value.dropped} log frames dropped; reloading captured lines.`,
            );
            void load();
            return;
          }
          if (value.timestamp_ms < currentRange().since) return;
          const el = ref.current,
            atBottom = el
              ? el.scrollHeight - el.clientHeight - el.scrollTop < 40
              : false;
          setLines((previous) => mergeLogs(previous, [value]).slice(-5000));
          if (atBottom)
            requestAnimationFrame(() => {
              if (el) el.scrollTop = el.scrollHeight;
            });
        } catch {
          /* Malformed stream frames do not replace captured log history. */
        }
      };
    }
    void load();
    if (live && running) connect();
    return () => {
      controller.abort();
      clearTimeout(timer);
      socket?.close();
      setStreaming(false);
    };
  }, [name, since, until, preset, live, running]);
  async function older() {
    if (busyRef.current || !cursorRef.current) return;
    busyRef.current = true;
    const run = generationRef.current,
      el = ref.current,
      previousHeight = el?.scrollHeight ?? 0;
    const result = await api.logs(
      name,
      live ? { ...range, until: Date.now() } : range,
      cursorRef.current,
    );
    if (run !== generationRef.current) return;
    busyRef.current = false;
    if (result.kind === "error") {
      setError(result.message);
      return;
    }
    setLines((previous) => mergeLogs(previous, result.value.logs));
    setCursor(result.value.next_cursor ?? null);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - previousHeight;
    });
  }
  const text = lines
    .map((l) => `${time(l.timestamp_ms)}  ${l.line}`)
    .join("\n");
  return (
    <section class="min-w-0 border-t border-line pt-3">
      <div class="flex flex-wrap items-center gap-2.5 pb-[9px]">
        <h3 class="text-[13px] leading-[1.35] font-semibold">Service log</h3>
        <span class="text-xs text-muted">
          {lines.length} lines ·{" "}
          {streaming ? "streaming" : live ? "captured" : "selected range"}
        </span>
        <span class="ml-auto flex">
          <Copy text={text} label="service log" />
        </span>
      </div>
      {error && <Message error={error} />}
      <div
        ref={ref}
        role="log"
        aria-label="Service log viewer"
        tabIndex={0}
        onScroll={(e) => {
          if (e.currentTarget.scrollTop < 20) void older();
        }}
        class="
          max-h-[230px] min-h-[180px] resize-y overflow-auto border border-line
          bg-[#0a0b0d] p-3 font-mono text-[12.5px] leading-[1.75] text-body
        "
      >
        {!lines.length && (
          <Message loading={loading} empty="No log lines in this range." />
        )}
        {lines.map((l) => (
          <div
            key={`${l.run_id}:${l.seq}`}
            class={
              l.stream === "stderr"
                ? `wrap-anywhere whitespace-pre-wrap text-soft`
                : `wrap-anywhere whitespace-pre-wrap`
            }
          >
            {time(l.timestamp_ms)} {l.line}
          </div>
        ))}
      </div>
      {cursor && (
        <span class="block py-2 text-xs text-muted">
          Scroll up for older lines
        </span>
      )}
    </section>
  );
}

function mergeLogs(a: readonly LogLine[], b: readonly LogLine[]) {
  const rows = new Map(a.map((l) => [`${l.run_id}:${l.seq}`, l]));
  for (const l of b) rows.set(`${l.run_id}:${l.seq}`, l);
  return [...rows.values()].sort(
    (a, b) =>
      a.timestamp_ms - b.timestamp_ms || a.run_id - b.run_id || a.seq - b.seq,
  );
}
