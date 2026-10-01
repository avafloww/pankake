import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import type { Result } from "./client";

export type Resource<T> = {
  readonly data?: T;
  readonly loading: boolean;
  readonly error?: string;
};

export function useResource<T>(
  key: string,
  read: (signal: AbortSignal) => Promise<Result<T>>,
  interval = 0,
  revision = 0,
): Resource<T> {
  const readerRef = useRef(read);
  useLayoutEffect(() => {
    readerRef.current = read;
  }, [read]);
  const identityRef = useRef(key);
  const [state, setState] = useState<Resource<T>>({ loading: true });
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    if (identityRef.current !== key) setState({ loading: true });
    identityRef.current = key;
    async function refresh() {
      const result = await readerRef.current(controller.signal);
      if (controller.signal.aborted) return;
      setState((previous) =>
        result.kind === "ok"
          ? { loading: false, data: result.value }
          : { ...previous, loading: false, error: result.message },
      );
      if (interval) timer = setTimeout(() => void refresh(), interval);
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, interval, revision]);
  return state;
}
