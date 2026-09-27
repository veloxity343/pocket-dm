import { useDeferredValue, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { EmptyState, Field, LoadError, Loading, Markdown, SaveStatus, Select, TextArea, TextInput, type Option } from "../components/ui";
import { useApp } from "../context/app";
import { Modal, useDialogs, useToast } from "../context/ui";
import { useDraft, useLoad, usePref } from "../lib/hooks";
import { download, downloadJson, pickFiles, slug } from "../lib/util";
import type { HandbookEntry } from "../types";

const TEMPLATES: Record<string, string> = {
  "House Rules": "## Rule\n\nDescribe the rule.\n\n## Why\n\nWhat it's for and when it applies.\n",
  NPCs: "**Role:** \n**Location:** \n**Wants:** \n**Secret:** \n\n## Appearance\n\n## Voice & mannerisms\n\n## Notes\n",
  Locations: "**Region:** \n\n## Overview\n\n## Points of interest\n\n- \n\n## Hooks\n\n- \n",
  Factions: "**Leader:** \n**Goals:** \n**Resources:** \n\n## Allies & enemies\n\n## Notes\n",
  Items: "*Wondrous item, rarity (requires attunement)*\n\nDescription.\n",
  Lore: "",
  "Random Tables": "| d6 | Result |\n|---|---|\n| 1 | |\n| 2 | |\n| 3 | |\n| 4 | |\n| 5 | |\n| 6 | |\n",
  Other: "",
};

export function HandbookList() {
  const { campaignId, campaigns } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [scope, setScope] = usePref<"all" | "campaign">("hb.scope", "all");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [template, setTemplate] = useState("House Rules");
  const { data: all, error, reload } = useLoad(() => api.list("handbook"), []);
  if (error) return <LoadError error={error} />;
  if (!all) return <Loading />;

  const needle = q.trim().toLowerCase();
  const list = all.filter(
    (e) =>
      (scope === "all" || !campaignId || e.campaign_id === campaignId || !e.campaign_id) &&
      (!needle || `${e.title} ${e.body} ${e.tags.join(" ")} ${e.category}`.toLowerCase().includes(needle)),
  );
  const groups: Record<string, HandbookEntry[]> = {};
  for (const e of list) (groups[e.category || "Other"] ||= []).push(e);

  const create = async () => {
    const e = await api.create("handbook", {
      title: `New ${template.replace(/s$/, "")}`, category: template, body: TEMPLATES[template], campaign_id: campaignId || "",
    });
    navigate(`/handbook/${e.id}`);
  };
  const importFiles = async () => {
    const files = await pickFiles({ accept: ".md,.markdown,.txt,.json", multiple: true });
    if (!files.length) return;
    const isJson = (name: string) => name.toLowerCase().endsWith(".json");
    try {
      const md = files.filter((f) => !isJson(f.name));
      if (md.length) {
        const r = await api.importMarkdown(md.map((f) => ({ filename: f.name, text: f.text })), campaignId || "");
        toast(`Imported ${r.created.length} Markdown file(s)`);
      }
      for (const f of files.filter((f) => isJson(f.name))) {
        const r = await api.importData(JSON.parse(f.text), "copy");
        toast(`${f.name}: imported ${Object.values(r.imported).reduce((a, b) => a + (b || 0), 0)} record(s)`);
      }
    } catch (e) {
      toast((e as Error).message, "error");
    }
    reload();
  };

  return (
    <>
      <header className="page-head">
        <h1>Handbook</h1>
        <div className="row gap wrap">
          {campaignId && (
            <Select aria-label="Scope" value={scope} options={[["all", "All entries"], ["campaign", "This campaign + shared"]]} onChange={(v) => setScope(v as typeof scope)} />
          )}
          <button type="button" className="btn" onClick={importFiles}>Import .md</button>
          <button type="button" className="btn primary" onClick={() => setCreating(true)}>+ New entry</button>
        </div>
      </header>
      <p className="muted">Your own rules, lore and notes — searchable alongside the SRD in Rules &amp; SRD.</p>
      <input type="search" className="wide" placeholder="Search your handbook…" aria-label="Search handbook" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.length ? (
        <div className="cards">
          {Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([cat, items]) => (
            <section className="panel" key={cat}>
              <h2>{cat}<span className="muted small"> {items.length}</span></h2>
              <ul className="list">
                {items.map((e) => (
                  <li key={e.id}>
                    <Link className="list-link" to={`/handbook/${e.id}`}>
                      <span className="grow">{e.title}</span>
                      {e.campaign_id && <span className="tag">{campaigns.find((c) => c.id === e.campaign_id)?.name || "campaign"}</span>}
                      {e.tags.slice(0, 3).map((t) => <span className="chip" key={t}>{t}</span>)}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          title={all.length ? "No matches" : "Your handbook is empty"}
          text={all.length ? "" : "Write house rules, NPCs, locations and lore — or import Markdown files you already have."}
        />
      )}
      {creating && (
        <Modal title="New handbook entry" onClose={() => setCreating(false)} actions={[{ label: "Cancel" }, { label: "Create", primary: true, onClick: create }]}>
          <Field label="Template"><Select value={template} options={Object.keys(TEMPLATES)} onChange={setTemplate} /></Field>
        </Modal>
      )}
    </>
  );
}

export function HandbookEditor() {
  const { id = "" } = useParams();
  const { data, error } = useLoad(() => Promise.all([api.get("handbook", id), api.list("campaigns")]), [id]);
  if (error) return <LoadError error={error} />;
  if (!data) return <Loading />;
  return <Editor key={id} initial={data[0]} campaigns={data[1].map((c): Option => [c.id, c.name])} />;
}

function Editor({ initial, campaigns }: { initial: HandbookEntry; campaigns: Option[] }) {
  const toast = useToast();
  const { confirm } = useDialogs();
  const navigate = useNavigate();
  const id = initial.id;
  const { doc: e, edit, flush, discard, status } = useDraft<HandbookEntry>(initial, (doc) => api.update("handbook", id, doc), {
    onError: (err) => toast(err.message, "error"),
  });
  const [tagText, setTagText] = useState(initial.tags.join(", "));
  const preview = useDeferredValue(e);
  if (!e || !preview) return null;
  const set = <K extends keyof HandbookEntry>(k: K) => (v: HandbookEntry[K]) => edit((d) => void (d[k] = v));
  const cats = [...new Set([...Object.keys(TEMPLATES), e.category, "Imported"])].filter(Boolean);

  const remove = async () => {
    if (!(await confirm(`Delete "${e.title}"?`))) return;
    discard();
    await api.remove("handbook", id);
    navigate("/handbook");
  };

  return (
    <>
      <header className="page-head">
        <Link to="/handbook" className="small">← Handbook</Link>
        <div className="row gap wrap">
          <SaveStatus status={status} />
          <button type="button" className="btn" onClick={async () => { await flush(); download(`${slug(e.title)}.md`, `# ${e.title}\n\n${e.body}\n`, "text/markdown"); }}>Export .md</button>
          <button type="button" className="btn" onClick={async () => { await flush(); downloadJson(`${slug(e.title)}.handbook.json`, await api.exportOne("handbook", id)); }}>Export .json</button>
          <button type="button" className="btn danger" onClick={remove}>Delete</button>
        </div>
      </header>
      <div className="grid-2 editor-grid">
        <section className="panel">
          <Field label="Title"><TextInput className="title-input" value={e.title} onChange={set("title")} /></Field>
          <div className="form-grid">
            <Field label="Category"><TextInput list="hb-cats" value={e.category} onChange={set("category")} /></Field>
            <Field label="Campaign"><Select value={e.campaign_id} options={[["", "Shared (all campaigns)"], ...campaigns]} onChange={set("campaign_id")} /></Field>
            <Field label="Tags">
              <TextInput placeholder="comma, separated" value={tagText} onChange={(v) => {
                setTagText(v);
                set("tags")(v.split(",").map((t) => t.trim()).filter(Boolean));
              }} />
            </Field>
          </div>
          <datalist id="hb-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
          <Field label="Body (Markdown — dice like 2d6 become clickable)"><TextArea rows={24} className="mono" value={e.body} onChange={set("body")} /></Field>
        </section>
        <div className="panel preview">
          <h2>{preview.title}</h2>
          <Markdown source={preview.body || "*Empty*"} rollContext={preview.title} />
        </div>
      </div>
    </>
  );
}
