import { useCallback, useEffect, useRef, useState } from "react";
import { readPref, writePref } from "./util";

/** State that persists in this browser's localStorage. */
export function usePref<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readPref(key, fallback));
  const set = useCallback(
    (v: T | ((prev: T) => T)) =>
      setValue((prev) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        writePref(key, next);
        return next;
      }),
    [key],
  );
  return [value, set] as const;
}

/** Load async data; `reload` re-runs the loader. Errors surface via `error`. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    load().then(
      (d) => live && setData(d),
      (e: Error) => live && setError(e),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, setData, error, reload };
}

export function useDebounced<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return useCallback(
    (...args: A) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => fnRef.current(...args), ms);
    },
    [ms],
  );
}

export type SaveStatus = "" | "Saving…" | "Saved" | "Save failed";

/**
 * An editable copy of a server record that saves itself.
 *
 * `edit(fn)` applies a mutation to a deep copy and schedules a debounced save;
 * `flush()` saves immediately (call it before server actions or navigation);
 * pending edits are also flushed on unmount.
 */
export function useDraft<T>(
  initial: T | null,
  save: (doc: T) => Promise<unknown>,
  { delay = 600, onError }: { delay?: number; onError?: (e: Error) => void } = {},
) {
  const [doc, setDocState] = useState<T | null>(initial);
  const [status, setStatus] = useState<SaveStatus>("");
  const docRef = useRef(doc);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saveRef = useRef(save);
  saveRef.current = save;
  const errRef = useRef(onError);
  errRef.current = onError;

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (!pending.current || !docRef.current) return;
    pending.current = false;
    try {
      await saveRef.current(docRef.current);
      setStatus("Saved");
    } catch (e) {
      setStatus("Save failed");
      errRef.current?.(e as Error);
    }
  }, []);

  /** Replace the draft without saving (e.g. with a fresh copy from the server). */
  const setDoc = useCallback((next: T | null) => {
    docRef.current = next;
    setDocState(next);
  }, []);

  const edit = useCallback(
    (fn: (draft: T) => void) => {
      if (!docRef.current) return;
      const next = structuredClone(docRef.current);
      fn(next);
      docRef.current = next;
      setDocState(next);
      pending.current = true;
      setStatus("Saving…");
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    [delay, flush],
  );

  /** Drop any unsaved edits (e.g. right before deleting the record). */
  const discard = useCallback(() => {
    clearTimeout(timer.current);
    pending.current = false;
  }, []);

  useEffect(() => () => void flush(), [flush]);

  return { doc, setDoc, edit, flush, discard, status };
}
