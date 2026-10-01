import { useEffect, useState } from "preact/hooks";

import { api, socketUrl } from "./client";
import { eventCodec } from "./contract";
import type { SystemEvent } from "./contract";
import { useResource } from "./resource";

export type CapturedEvent = {
  readonly event: SystemEvent;
  readonly receivedAt: number;
};

export function useSystem() {
  const [revision, setRevision] = useState(0);
  const [events, setEvents] = useState<readonly CapturedEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [capturedSince] = useState(Date.now);
  const services = useResource("services", api.services, 2500, revision);
  const devices = useResource("devices", api.devices, 2500);
  const info = useResource("info", api.info, 30_000);
  useEffect(() => {
    let disposed = false;
    let socket: WebSocket;
    let timer: ReturnType<typeof setTimeout>;
    function connect() {
      socket = new WebSocket(socketUrl("/api/events"));
      socket.onopen = () => {
        setConnected(true);
        setRevision((n) => n + 1);
      };
      socket.onclose = () => {
        setConnected(false);
        if (!disposed) timer = setTimeout(connect, 2000);
      };
      socket.onmessage = (message) => {
        try {
          const event: unknown = JSON.parse(message.data);
          if (!eventCodec(event)) return;
          setEvents((previous) => [
            ...previous.slice(-1999),
            { event, receivedAt: Date.now() },
          ]);
          setRevision((n) => n + 1);
        } catch {
          /* Ignore malformed frames; polling still refreshes the inventory. */
        }
      };
    }
    connect();
    return () => {
      disposed = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, []);
  return {
    services,
    devices,
    info,
    events,
    connected,
    capturedSince,
    revision,
    refresh: () => setRevision((n) => n + 1),
  };
}
