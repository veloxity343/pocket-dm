import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Modal, useDrawer, useToast } from "../context/ui";
import { useDebounced } from "../lib/hooks";
import type { SrdEntry } from "../types";
import { Checkbox, Markdown } from "./ui";

/** Opens an SRD entry (statblock, spell...) in the side drawer. */
export function useStatblock() {
  const drawer = useDrawer();
  const toast = useToast();
  return useCallback(
    async (srdId: string, title?: string) => {
      try {
        const e = await api.srdEntry(srdId);
        drawer.open(title || e.name, (
          <>
            <p className="muted">{e.summary}</p>
            <Markdown source={e.body || ""} rollContext={title || e.name} />
          </>
        ));
      } catch (err) {
        toast((err as Error).message, "error");
      }
    },
    [drawer, toast],
  );
}

/** Search an SRD category in a modal; each click hands an entry back. */
export function SrdPicker({ category, className = "", onPick, onClose }: {
  category: string;
  className?: string;
  onPick: (e: SrdEntry) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [onlyClass, setOnlyClass] = useState(category === "spells" && !!className);
  const [results, setResults] = useState<SrdEntry[]>([]);
  const search = useDebounced((text: string, cls: boolean) => {
    api
      .srdSearch({ q: text.trim(), category, limit: 60, classes: cls ? className : undefined })
      .then((r) => setResults(r.results), (e: Error) => toast(e.message, "error"));
  }, 200);
  useEffect(() => search(q, onlyClass), [q, onlyClass, search]);

  return (
    <Modal title="Add from SRD" onClose={onClose} actions={[{ label: "Done", primary: true }]}>
      <div className="stack">
        <input type="search" className="wide" autoFocus placeholder={`Search ${category.replace("-", " ")}…`} value={q} onChange={(e) => setQ(e.target.value)} />
        {category === "spells" && className && (
          <label className="check small"><Checkbox checked={onlyClass} onChange={setOnlyClass} /> Only {className} spells</label>
        )}
        <ul className="list pick-list">
          {results.map((e) => (
            <li key={e.id}>
              <button type="button" className="list-link" onClick={() => { onPick(e); toast(`Added ${e.name}`); }}>
                <span className="grow">{e.name}</span>
                <span className="muted small">{e.summary}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="muted small">Click to add; add as many as you like.</p>
      </div>
    </Modal>
  );
}
