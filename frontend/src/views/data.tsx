import { useState } from "react";
import { api } from "../api";
import { LoadError, Loading, Select, type Option } from "../components/ui";
import { useApp } from "../context/app";
import { useToast } from "../context/ui";
import { useLoad } from "../lib/hooks";
import { downloadJson, pickFiles, slug, today } from "../lib/util";
import type { Kind } from "../types";

const KINDS: Kind[] = ["campaigns", "sessions", "characters", "handbook"];
const MODES: [string, string][] = [
  ["overwrite", "Overwrite — replace records that have the same id (restoring a backup)"],
  ["skip", "Skip — keep my existing records, only add new ones"],
  ["copy", "Copy — import everything as new records (sharing between DMs)"],
];

export function DataPage() {
  const { meta, campaigns, campaignId, refreshCampaigns } = useApp();
  const toast = useToast();
  const [exportId, setExportId] = useState(campaignId);
  const [mode, setMode] = useState("overwrite");
  const [report, setReport] = useState<string[]>([]);
  const { data: counts, error, reload } = useLoad(() => Promise.all(KINDS.map(async (k) => [k, (await api.list(k)).length] as const)), []);
  if (error) return <LoadError error={error} />;
  if (!counts) return <Loading />;

  const doImport = async () => {
    const files = await pickFiles({ accept: ".json,.md,.markdown,.txt,application/json", multiple: true });
    if (!files.length) return;
    const lines: string[] = [];
    for (const f of files) {
      try {
        if (/\.(md|markdown|txt)$/i.test(f.name)) {
          const r = await api.importMarkdown([{ filename: f.name, text: f.text }], campaignId || "");
          lines.push(`✔ ${f.name}: handbook entry “${r.created[0].title}”`);
        } else {
          const r = await api.importData(JSON.parse(f.text), mode);
          const imp = Object.entries(r.imported).map(([k, v]) => `${v} ${k}`).join(", ") || "nothing new";
          const skip = Object.entries(r.skipped).map(([k, v]) => `${v} ${k}`).join(", ");
          lines.push(`✔ ${f.name}: imported ${imp}${skip ? ` (skipped ${skip})` : ""}`);
        }
      } catch (e) {
        lines.push(`✘ ${f.name}: ${(e as Error).message}`);
      }
    }
    setReport(lines);
    toast("Import finished");
    await refreshCampaigns();
    reload();
  };
  const exportCampaign = async () => {
    const id = exportId || campaigns[0].id;
    const name = campaigns.find((c) => c.id === id)?.name || "campaign";
    downloadJson(`${slug(name)}.pocketdm.json`, await api.exportAll(id));
  };

  return (
    <>
      <header className="page-head"><h1>Import / Export</h1></header>
      <div className="grid-2">
        <section className="panel">
          <h2>Export</h2>
          <p>Everything is plain JSON you can back up, version, or hand to another DM.</p>
          <div className="stack">
            <button type="button" className="btn primary" onClick={async () => downloadJson(`pocket-dm-backup-${today()}.pocketdm.json`, await api.exportAll())}>
              ⬇ Full backup (all data)
            </button>
            {campaigns.length > 0 && (
              <div className="row gap">
                <Select aria-label="Campaign to export" value={exportId || campaigns[0].id} options={campaigns.map((c): Option => [c.id, c.name])} onChange={setExportId} />
                <button type="button" className="btn" onClick={exportCampaign}>⬇ Export campaign</button>
              </div>
            )}
            <p className="muted small">Single characters, sessions and handbook entries can be exported as JSON or Markdown from their own pages.</p>
          </div>
          <h3>Stored locally</h3>
          <ul className="small">{counts.map(([k, n]) => <li key={k}>{n} {k}</li>)}</ul>
          <p className="muted small">Database: <code>{meta?.database || "?"}</code></p>
        </section>
        <section className="panel">
          <h2>Import</h2>
          <p>Accepts Pocket DM backups, campaign exports, single-record exports (.json), and Markdown files (.md) which become handbook entries.</p>
          <div className="stack">
            {MODES.map(([v, label]) => (
              <label className="check" key={v}>
                <input type="radio" name="mode" value={v} checked={v === mode} onChange={() => setMode(v)} /> {label}
              </label>
            ))}
            <button type="button" className="btn primary" onClick={doImport}>⬆ Choose files to import</button>
          </div>
          {report.length > 0 && (
            <div className="import-report">
              <ul>{report.map((l, i) => <li key={i} className={l.startsWith("✘") ? "bad" : ""}>{l}</li>)}</ul>
            </div>
          )}
        </section>
      </div>
      <section className="panel">
        <h2>About the rules content</h2>
        <p className="small">{meta?.srd?.attribution}</p>
        <p className="muted small">{meta?.srd?.source}</p>
        <p className="muted small">Pocket DM {meta?.version}</p>
      </section>
    </>
  );
}
