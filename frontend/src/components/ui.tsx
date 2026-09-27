// Form controls and small building blocks shared by the views.

import { useEffect, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { markdown } from "../lib/markdown";
import { hpLevel, titleCase } from "../lib/util";
import { useApp } from "../context/app";

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">;

export function Field({ label, hint, className = "", children }: { label: ReactNode; hint?: string; className?: string; children: ReactNode }) {
  return (
    <label className={`field ${className}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function TextInput({ value, onChange, ...rest }: InputProps & { value: string; onChange: (v: string) => void }) {
  return <input type="text" {...rest} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
}

/**
 * Number box that keeps its own text so it can be cleared while typing.
 * With `commit`, it only reports on blur / Enter (for inputs whose change
 * triggers a server round trip).
 */
export function NumInput({ value, onChange, commit = false, className = "num-input", ...rest }: InputProps & {
  value: number;
  onChange: (v: number) => void;
  commit?: boolean;
}) {
  const [text, setText] = useState(String(value ?? 0));
  useEffect(() => {
    setText((t) => (Number(t) === value && t !== "" ? t : String(value ?? 0)));
  }, [value]);
  const report = (t: string) => {
    const n = t === "" ? 0 : Number(t);
    if (!Number.isNaN(n) && n !== value) onChange(n);
  };
  return (
    <input
      type="number"
      className={className}
      {...rest}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        if (!commit) report(e.target.value);
      }}
      onBlur={() => commit && report(text)}
      onKeyDown={(e) => commit && e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

export function TextArea({ value, onChange, rows = 4, ...rest }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onChange: (v: string) => void;
}) {
  return <textarea rows={rows} {...rest} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
}

export type Option = string | [value: string, label: string];

export function Select({ value, options, onChange, ...rest }: Omit<InputHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> & {
  value: string;
  options: Option[];
  onChange: (v: string) => void;
}) {
  return (
    <select {...rest} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => {
        const [v, label] = Array.isArray(o) ? o : [o, o];
        return <option key={v} value={v}>{label}</option>;
      })}
    </select>
  );
}

export function Checkbox({ checked, onChange, ...rest }: InputProps & { checked: boolean; onChange: (v: boolean) => void }) {
  return <input type="checkbox" {...rest} checked={!!checked} onChange={(e) => onChange(e.target.checked)} />;
}

export function EmptyState({ title, text, children }: { title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}

export function Loading() {
  return <div className="loading">Loading…</div>;
}

export function LoadError({ error }: { error: Error }) {
  return <EmptyState title="Something went wrong" text={error.message} />;
}

/** Rendered Markdown; dice in the text roll on click, labelled with `rollContext`. */
export function Markdown({ source, rollContext }: { source: string; rollContext?: string }) {
  return <div className="md" data-roll-context={rollContext} dangerouslySetInnerHTML={{ __html: markdown(source) }} />;
}

export function HpBar({ current, max }: { current: number; max: number }) {
  const pct = max ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
  return (
    <div className="hp-bar" role="presentation">
      <div className="hp-fill" style={{ width: `${pct}%` }} data-level={hpLevel(pct)} />
    </div>
  );
}

export function SaveStatus({ status }: { status: string }) {
  return <span className="save-status muted small">{status}</span>;
}

/** Condition chips with a picker to add more. */
export function Conditions({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { meta } = useApp();
  const available = (meta?.conditions || []).filter((k) => !value.includes(k));
  return (
    <div className="chips">
      {value.map((k) => (
        <span className="chip" key={k}>
          {titleCase(k)}
          <button type="button" className="chip-x" aria-label={`Remove ${k}`} onClick={() => onChange(value.filter((x) => x !== k))}>×</button>
        </span>
      ))}
      <Select
        className="small-select"
        aria-label="Add condition"
        value=""
        options={[["", "+ condition"], ...available.map((k): Option => [k, titleCase(k)])]}
        onChange={(v) => v && onChange([...value, v])}
      />
    </div>
  );
}

/** A Markdown text area with an edit / preview toggle. */
export function MdEditor({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [preview, setPreview] = useState(false);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{label}</h2>
        <button type="button" className="btn small" onClick={() => setPreview((p) => !p)}>{preview ? "Edit" : "Preview"}</button>
      </div>
      {preview ? <Markdown source={value || "*Nothing here yet.*"} /> : <TextArea rows={14} value={value} onChange={onChange} placeholder={placeholder} />}
    </section>
  );
}

/** A table of editable rows with add / remove. */
export function ListSection<T>({ title, items, onChange, blank, head, row, extra }: {
  title: string;
  items: T[];
  onChange: (items: T[]) => void;
  blank: () => T;
  head: string[];
  /** Cells for one row; `set` merges a change into that row. */
  row: (item: T, set: (patch: Partial<T>) => void, index: number) => ReactNode[];
  extra?: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <div className="row gap wrap">
          {extra}
          <button type="button" className="btn small" onClick={() => onChange([...items, blank()])}>+ Add</button>
        </div>
      </div>
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr>{head.map((t, i) => <th key={i}>{t}</th>)}</tr></thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                {row(it, (patch) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x))), i).map((cell, j) => <td key={j}>{cell}</td>)}
                <td>
                  <button type="button" className="icon-btn" aria-label="Remove row" onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
