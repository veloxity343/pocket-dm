import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { EmptyState, Field, LoadError, Loading, SaveStatus, Select, TextArea, TextInput } from "../components/ui";
import { useApp } from "../context/app";
import { useDialogs, useToast } from "../context/ui";
import { useDraft, useLoad } from "../lib/hooks";
import { downloadJson, fmtDate, plural, slug, today } from "../lib/util";
import type { Campaign, Character, HandbookEntry, Player, Session } from "../types";

export function CampaignList() {
  const { campaignId, setCampaignId, refreshCampaigns } = useApp();
  const navigate = useNavigate();
  const { data, error } = useLoad(() => Promise.all([api.list("campaigns"), api.list("sessions")]), []);
  if (error) return <LoadError error={error} />;
  if (!data) return <Loading />;
  const [list, sessions] = data;

  const create = async () => {
    const c = await api.create("campaigns", { name: "New Campaign" });
    setCampaignId(c.id);
    await refreshCampaigns();
    navigate(`/campaigns/${c.id}`);
  };

  return (
    <>
      <header className="page-head">
        <h1>Campaigns</h1>
        <button type="button" className="btn primary" onClick={create}>+ New campaign</button>
      </header>
      {list.length ? (
        <div className="cards">
          {list.map((c) => {
            const ss = sessions.filter((s) => s.campaign_id === c.id);
            const next = ss.find((s) => s.status !== "done");
            return (
              <Link key={c.id} className={`card campaign-card ${c.id === campaignId ? "selected" : ""}`} to={`/campaigns/${c.id}`} onClick={() => setCampaignId(c.id)}>
                <h3>{c.name}</h3>
                <p className="muted clamp">{c.description || c.setting || "No description yet."}</p>
                <div className="card-meta">
                  <span>{plural(c.players.length, "player")}</span>
                  <span>{plural(ss.length, "session")}</span>
                  {next && <span className="tag">Next: #{next.number} {next.title}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <EmptyState title="Start your first campaign" text="A campaign keeps your players, sessions, characters and house rules together.">
          <button type="button" className="btn primary" onClick={create}>+ New campaign</button>
        </EmptyState>
      )}
    </>
  );
}

export function CampaignDetail() {
  const { id = "" } = useParams();
  const { data, error } = useLoad(
    () => Promise.all([api.get("campaigns", id), api.list("sessions", { campaign_id: id }), api.list("characters"), api.list("handbook", { campaign_id: id })]),
    [id],
  );
  if (error) return <LoadError error={error} />;
  if (!data) return <Loading />;
  const [campaign, sessions, characters, handbook] = data;
  return <CampaignEditor key={id} initial={campaign} sessions={sessions} characters={characters} handbook={handbook} />;
}

function CampaignEditor({ initial, sessions, characters, handbook }: {
  initial: Campaign;
  sessions: Session[];
  characters: Character[];
  handbook: HandbookEntry[];
}) {
  const { setCampaignId, setSessionId, refreshCampaigns } = useApp();
  const toast = useToast();
  const { confirm } = useDialogs();
  const navigate = useNavigate();
  const id = initial.id;
  const { doc: c, edit, flush, discard, status } = useDraft<Campaign>(initial, async (doc) => {
    await api.update("campaigns", id, doc);
    await refreshCampaigns();
  }, { onError: (e) => toast(e.message, "error") });

  useEffect(() => setCampaignId(id), [id, setCampaignId]);
  if (!c) return null;

  const set = <K extends keyof Campaign>(k: K) => (v: Campaign[K]) => edit((d) => void (d[k] = v));
  const setPlayer = (i: number, patch: Partial<Player>) => edit((d) => void Object.assign(d.players[i], patch));
  const partyChars = characters.filter((ch) => ch.campaign_id === id || c.players.some((p) => p.character_id === ch.id));
  const charOptions: [string, string][] = [["", "— none —"], ...characters.map((ch): [string, string] => [ch.id, ch.name])];

  const newSession = async () => {
    await flush();
    const number = sessions.reduce((m, s) => Math.max(m, s.number), 0) + 1;
    const s = await api.create("sessions", { campaign_id: id, number, title: `Session ${number}`, date: today() });
    setSessionId(s.id);
    navigate(`/sessions/${s.id}`);
  };
  const newCharacter = async () => {
    await flush();
    const ch = await api.create("characters", { campaign_id: id });
    navigate(`/characters/${ch.id}`);
  };
  const exportCampaign = async () => {
    await flush();
    downloadJson(`${slug(c.name)}.pocketdm.json`, await api.exportAll(id));
  };
  const remove = async () => {
    if (!(await confirm(`Delete "${c.name}" and its ${sessions.length} session(s)? Characters and handbook entries are kept.`))) return;
    discard();
    await api.remove("campaigns", id);
    setCampaignId("");
    await refreshCampaigns();
    navigate("/");
  };

  return (
    <>
      <header className="page-head">
        <div>
          <Link to="/" className="small">← All campaigns</Link>
          <h1>{c.name}</h1>
        </div>
        <div className="row gap wrap">
          <SaveStatus status={status} />
          <button type="button" className="btn" onClick={exportCampaign}>Export campaign</button>
          <button type="button" className="btn danger" onClick={remove}>Delete</button>
        </div>
      </header>
      <div className="grid-2">
        <section className="panel">
          <h2>Overview</h2>
          <Field label="Name"><TextInput value={c.name} onChange={set("name")} /></Field>
          <Field label="System"><TextInput value={c.system} onChange={set("system")} /></Field>
          <Field label="Setting"><TextInput value={c.setting} onChange={set("setting")} placeholder="e.g. Forgotten Realms, homebrew world…" /></Field>
          <Field label="Pitch / description"><TextArea rows={3} value={c.description} onChange={set("description")} /></Field>
          <Field label="DM notes"><TextArea rows={6} value={c.notes} onChange={set("notes")} placeholder="Secrets, plot threads, NPCs… (Markdown)" /></Field>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Sessions</h2>
            <button type="button" className="btn primary small" onClick={newSession}>+ New session</button>
          </div>
          {sessions.length ? (
            <ul className="list">
              {[...sessions].reverse().map((s) => (
                <li key={s.id}>
                  <Link to={`/sessions/${s.id}`} className="list-link">
                    <span className="num">#{s.number}</span>
                    <span className="grow">{s.title}</span>
                    <span className={`tag status-${s.status}`}>{s.status}</span>
                    <span className="muted small">{s.date}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="muted">No sessions yet.</p>}
          <div className="panel-head">
            <h2>Party</h2>
            <button type="button" className="btn small" onClick={newCharacter}>+ New character</button>
          </div>
          {partyChars.length ? (
            <ul className="list">
              {partyChars.map((ch) => (
                <li key={ch.id}>
                  <Link to={`/characters/${ch.id}`} className="list-link">
                    <span className="grow">{ch.name}</span>
                    <span className="muted small">{ch.race} {ch.classes.map((k) => k.name).join("/")} {ch.classes.reduce((a, k) => a + (k.level || 0), 0)}</span>
                    <span className="tag">HP {ch.hp.current}/{ch.hp.max}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="muted">No characters linked to this campaign yet.</p>}
          {handbook.length > 0 && (
            <>
              <h2>Campaign handbook</h2>
              <ul className="list">
                {handbook.map((e) => (
                  <li key={e.id}>
                    <Link className="list-link" to={`/handbook/${e.id}`}>
                      <span className="grow">{e.title}</span>
                      <span className="muted small">{e.category}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>Players</h2>
          <button type="button" className="btn small" onClick={() => edit((d) => void d.players.push({ name: "", contact: "", character_id: "", notes: "" }))}>+ Add player</button>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr>{["Player", "Character", "Contact", "Notes", ""].map((t) => <th key={t}>{t}</th>)}</tr></thead>
            <tbody>
              {c.players.map((p, i) => (
                <tr key={i}>
                  <td><TextInput value={p.name} onChange={(v) => setPlayer(i, { name: v })} placeholder="Player name" aria-label="Player name" /></td>
                  <td><Select value={p.character_id} options={charOptions} onChange={(v) => setPlayer(i, { character_id: v })} aria-label="Character" /></td>
                  <td><TextInput value={p.contact} onChange={(v) => setPlayer(i, { contact: v })} placeholder="Discord, email…" aria-label="Contact" /></td>
                  <td><TextInput value={p.notes} onChange={(v) => setPlayer(i, { notes: v })} placeholder="Notes" aria-label="Notes" /></td>
                  <td className="row gap">
                    {p.character_id && <Link className="btn small" to={`/characters/${p.character_id}`}>Sheet</Link>}
                    <button type="button" className="icon-btn" aria-label="Remove player" onClick={() => edit((d) => void d.players.splice(i, 1))}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">Last updated {fmtDate(initial.updated)}</p>
      </section>
    </>
  );
}
