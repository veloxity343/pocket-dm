// Toasts, modal dialogs and the side drawer, available to every view.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

// ------------------------------------------------------------------ toasts

export type ToastKind = "info" | "error" | "success" | "roll";
interface Toast {
  id: number;
  message: ReactNode;
  kind: ToastKind;
  leaving: boolean;
}
type ToastFn = (message: ReactNode, kind?: ToastKind, ms?: number) => void;

const ToastContext = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);
  const toast = useCallback<ToastFn>((message, kind = "info", ms = 3200) => {
    const id = next.current++;
    setToasts((t) => [...t, { id, message, kind, leaving: false }]);
    setTimeout(() => {
      setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 300);
    }, ms);
  }, []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div id="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}${t.leaving ? " leaving" : ""}`} role="status">
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ------------------------------------------------------------------ modal

export interface ModalAction {
  label: string;
  primary?: boolean;
  danger?: boolean;
  /** Return false to keep the dialog open. */
  onClick?: () => unknown;
}

export function Modal({ title, children, actions = [], onClose }: {
  title: string;
  children: ReactNode;
  actions?: ModalAction[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dlg = ref.current;
    if (dlg && !dlg.open) dlg.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
      </div>
      <div className="modal-body">{children}</div>
      {actions.length > 0 && (
        <div className="modal-actions">
          {actions.map((a) => (
            <button
              type="button"
              key={a.label}
              className={a.primary ? "btn primary" : a.danger ? "btn danger" : "btn"}
              onClick={async () => {
                if ((await a.onClick?.()) !== false) onClose();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </dialog>
  );
}

// ------------------------------------------------------------------ confirm / prompt

interface Dialogs {
  confirm: (message: string, opts?: { label?: string; danger?: boolean }) => Promise<boolean>;
  prompt: (title: string, opts?: { label?: string; value?: string }) => Promise<string | null>;
}
const DialogContext = createContext<Dialogs>({ confirm: async () => false, prompt: async () => null });
export const useDialogs = () => useContext(DialogContext);

type Pending =
  | { type: "confirm"; message: string; label: string; danger: boolean; resolve: (v: boolean) => void }
  | { type: "prompt"; title: string; label: string; value: string; resolve: (v: string | null) => void };

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState("");
  const confirm = useCallback<Dialogs["confirm"]>(
    (message, { label = "Delete", danger = true } = {}) =>
      new Promise((resolve) => setPending({ type: "confirm", message, label, danger, resolve })),
    [],
  );
  const prompt = useCallback<Dialogs["prompt"]>((title, { label = "", value = "" } = {}) => {
    setText(value);
    return new Promise((resolve) => setPending({ type: "prompt", title, label, value, resolve }));
  }, []);

  const close = (result: boolean | string | null) => {
    if (!pending) return;
    if (pending.type === "confirm") pending.resolve(result === true);
    else pending.resolve(typeof result === "string" ? result.trim() : null);
    setPending(null);
  };

  return (
    <DialogContext.Provider value={{ confirm, prompt }}>
      {children}
      {pending?.type === "confirm" && (
        <Modal
          title="Are you sure?"
          onClose={() => close(false)}
          actions={[
            { label: "Cancel", onClick: () => close(false) },
            { label: pending.label, danger: pending.danger, primary: !pending.danger, onClick: () => close(true) },
          ]}
        >
          <p>{pending.message}</p>
        </Modal>
      )}
      {pending?.type === "prompt" && (
        <Modal
          title={pending.title}
          onClose={() => close(null)}
          actions={[{ label: "Cancel", onClick: () => close(null) }, { label: "OK", primary: true, onClick: () => close(text) }]}
        >
          <label className="field">
            {pending.label && <span>{pending.label}</span>}
            <input
              type="text"
              className="wide"
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && close(text)}
            />
          </label>
        </Modal>
      )}
    </DialogContext.Provider>
  );
}

// ------------------------------------------------------------------ drawer

interface DrawerState {
  title: string;
  content: ReactNode;
}
const DrawerContext = createContext<{ open: (title: string, content: ReactNode) => void; close: () => void }>({
  open: () => {},
  close: () => {},
});
export const useDrawer = () => useContext(DrawerContext);

export function DrawerProvider({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [shown, setShown] = useState(false);
  const location = useLocation();
  const open = useCallback((title: string, content: ReactNode) => {
    setDrawer({ title, content });
    requestAnimationFrame(() => setShown(true));
  }, []);
  const close = useCallback(() => {
    setShown(false);
    setTimeout(() => setDrawer(null), 200);
  }, []);
  useEffect(close, [location.pathname, close]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);
  return (
    <DrawerContext.Provider value={{ open, close }}>
      {children}
      {drawer && (
        <aside className={`drawer${shown ? " open" : ""}`} role="complementary">
          <div className="drawer-head">
            <h2>{drawer.title}</h2>
            <button type="button" className="icon-btn" aria-label="Close" onClick={close}>✕</button>
          </div>
          <div className="drawer-body">{drawer.content}</div>
        </aside>
      )}
    </DrawerContext.Provider>
  );
}
