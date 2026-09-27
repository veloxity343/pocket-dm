import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useStatblock } from "../components/srd";
import {
  Checkbox, Conditions, EmptyState, Field, HpBar, LoadError, Loading, MdEditor, NumInput, SaveStatus, Select, TextInput,
} from "../components/ui";
import { useApp } from "../context/app";
import { useDice } from "../context/dice";
import { Modal, useDialogs, useToast } from "../context/ui";
import { useDebounced, useDraft, useLoad } from "../lib/hooks";
import { download, downloadJson, fmtDate, signed, titleCase, today } from "../lib/util";
import type { Campaign, Character, Combatant, CombatantKind, EncounterAction, Session, SrdEntry } from "../types";

const LOG_KINDS = ["note", "combat", "roll", "loot", "npc", "quest", "lore"];
const TABS = [
  ["encounter", "⚔️ Encounter"],
  ["log", "📝 Log"],
  ["notes", "📋 Prep & Recap"],
  ["loot", "💰 Loot & XP"],
] as const;
type Tab = (typeof TABS)[number][0];

export function SessionList() {
  const { campaignId: cid, campaigns } = useApp();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: sessions, error } = useLoad(() => api.list("sessions", { campaign_id: cid }), [cid]);
  if (error) return <LoadError error={error} />;
  if (!sessions) return <Loading />;
  const campName = (id: string) => campaigns.find((c) => c.id === id)?.name || "—";

  const create = async () => {
    if (!cid) {
      toast("Pick or create a campaign first", "error");
      return navigate("/");
    }
    const number = sessions.reduce((m, s) => Math.max(m, s.number), 0) + 1;
    const s = await api.create("sessions", { campaign_id: cid, number, title: `Session ${number}`, date: today() });
    navigate(`/sessions/${s.id}`);
  };

  return (
    <>
      <header className="page-head">
        <h1>{cid ? `Sessions · ${campName(cid)}` : "All sessions"}</h1>
        <button type="button" className="btn primary" onClick={create}>+ New session</button>
      </header>
      {sessions.length ? (
        <div className="panel">
          <ul className="list">
            {[...sessions].reverse().map((s) => (
              <li key={s.id}>
                <Link to={`/sessions/${s.id}`} className="list-link">
                  <span className="num">#{s.number}</span>
                  <span className="grow">{s.title}{!cid && <span className="muted small"> · {campName(s.campaign_id)}</span>}</span>
                  {s.encounter.active && <span className="tag crit">In combat · round {s.encounter.round}</span>}
                  <span className={`tag status-${s.status}`}>{s.status}</span>
                  <span className="muted small">{s.date}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <EmptyState title="No sessions yet" text={cid ? "Plan your next game night." : "Select a campaign in the sidebar, then create a session."}>
          {cid && <button type="button" className="btn primary" onClick={create}>+ New session</button>}
        </EmptyState>
      )}
    </>
  );
}

export function SessionDetail() {
  const { id = "", tab = "encounter" } = useParams();
  const { data, error } = useLoad(async () => {
    const s = await api.get("sessions", id);
    const [campaign, chars] = await Promise.all([
      s.campaign_id ? api.get("campaigns", s.campaign_id).catch(() => null) : null,
      api.list("characters"),
    ]);
    const party = chars.filter((c) => (s.campaign_id && c.campaign_id === s.campaign_id) || campaign?.players.some((p) => p.character_id === c.id));
    return { s, campaign, party };
  }, [id]);
  if (error) return <LoadError error={error} />;
  if (!data) return <Loading />;
  return <SessionEditor key={id} initial={data.s} campaign={data.campaign} party={data.party} tab={tab as Tab} />;
}

// Fields owned by the page; the encounter and log are changed only through server actions.
const EDITABLE = ["title", "date", "status", "number", "prep", "recap", "loot", "attendance"] as const;

function SessionEditor({ initial, campaign, party, tab }: { initial: Session; campaign: Campaign | null; party: Character[]; tab: Tab }) {
  const { setSessionId } = useApp();
  const toast = useToast();
  const { confirm } = useDialogs();
  const navigate = useNavigate();
  const id = initial.id;
  const { doc: s, setDoc, edit, flush, discard, status } = useDraft<Session>(
    initial,
    (doc) => api.update("sessions", id, Object.fromEntries(EDITABLE.map((k) => [k, doc[k]]))),
    { onError: (e) => toast(e.message, "error") },
  );
  useEffect(() => setSessionId(id), [id, setSessionId]);
  if (!s) return null;

  const set = <K extends keyof Session>(k: K) => (v: Session[K]) => edit((d) => void (d[k] = v));
  /** Run a server action (which returns the whole session) after saving local edits. */
  const run: Run = async (fn) => {
    try {
      await flush();
      setDoc(await fn());
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    }
  };
  const act = (action: EncounterAction) => run(() => api.encounter(id, action));

  const remove = async () => {
    if (!(await confirm(`Delete session #${s.number} "${s.title}"?`))) return;
    discard();
    await api.remove("sessions", id);
    setSessionId("");
    navigate(campaign ? `/campaigns/${campaign.id}` : "/sessions");
  };

  return (
    <>
      <header className="page-head">
        <div>
          {campaign ? <Link to={`/campaigns/${campaign.id}`} className="small">← {campaign.name}</Link> : <Link to="/sessions" className="small">← Sessions</Link>}
          <div className="row gap wrap session-title">
            <span className="num big">#</span>
            <NumInput value={s.number} onChange={set("number")} min={0} aria-label="Session number" />
            <TextInput className="title-input" value={s.title} onChange={set("title")} aria-label="Session title" />
          </div>
        </div>
        <div className="row gap wrap">
          <SaveStatus status={status} />
          <input type="date" value={s.date} onChange={(e) => set("date")(e.target.value)} aria-label="Date" />
          <Select value={s.status} options={[["planned", "Planned"], ["active", "In progress"], ["done", "Done"]]} onChange={(v) => set("status")(v as Session["status"])} aria-label="Status" />
          <button type="button" className="btn" onClick={async () => { await flush(); download(`session-${s.number}.md`, await api.exportMarkdown("sessions", id), "text/markdown"); }}>Export .md</button>
          <button type="button" className="btn" onClick={async () => { await flush(); downloadJson(`session-${s.number}.json`, await api.exportOne("sessions", id)); }}>Export .json</button>
          <button type="button" className="btn danger" onClick={remove}>Delete</button>
        </div>
      </header>
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <NavLink key={k} to={`/sessions/${id}/${k}`} role="tab" className={k === tab ? "active" : ""} aria-selected={k === tab}>{label}</NavLink>
        ))}
      </div>
      <div className="tab-body">
        {tab === "log" ? (
          <LogTab s={s} run={run} />
        ) : tab === "notes" ? (
          <div className="grid-2">
            <MdEditor label="Prep" value={s.prep} onChange={set("prep")} placeholder="Strong start, scenes, secrets & clues, NPCs, locations, monsters, rewards… (Markdown)" />
            <MdEditor label="Recap" value={s.recap} onChange={set("recap")} placeholder="What happened this session — share it with players afterwards." />
          </div>
        ) : tab === "loot" ? (
          <LootTab s={s} party={party} edit={edit} run={run} />
        ) : (
          <EncounterTab s={s} party={party} act={act} />
        )}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ encounter

type Act = (action: EncounterAction) => Promise<boolean>;
type Run = (fn: () => Promise<Session>) => Promise<boolean>;

function EncounterTab({ s, party, act }: { s: Session; party: Character[]; act: Act }) {
  const { confirm } = useDialogs();
  const toast = useToast();
  const [dialog, setDialog] = useState<"" | "party" | "monster" | "custom">("");
  const enc = s.encounter;
  const current = enc.active ? enc.combatants[enc.turn] : null;
  const monsterXp = enc.combatants.filter((c) => c.kind === "monster").reduce((a, c) => a + (c.xp || 0), 0);
  const pcCount = enc.combatants.filter((c) => c.kind === "pc").length;

  return (
    <>
      <div className="toolbar">
        <div className="row gap wrap">
          <button type="button" className="btn" onClick={() => (party.length ? setDialog("party") : toast("No characters in this campaign yet", "error"))}>+ Party</button>
          <button type="button" className="btn" onClick={() => setDialog("monster")}>+ Monster</button>
          <button type="button" className="btn" onClick={() => setDialog("custom")}>+ Custom</button>
        </div>
        <div className="row gap wrap">
          <button type="button" className="btn" title="Roll for monsters and NPCs" onClick={() => act({ action: "roll_initiative", which: "monsters" })}>🎲 Roll NPC init</button>
          <button type="button" className="btn" onClick={() => act({ action: "roll_initiative", which: "all" })}>🎲 Roll all</button>
          <button type="button" className="btn" onClick={() => act({ action: "sort" })}>Sort</button>
        </div>
        <div className="row gap wrap">
          {enc.active && <button type="button" className="btn" aria-label="Previous turn" onClick={() => act({ action: "prev" })}>◀</button>}
          <button type="button" className="btn primary" onClick={() => act({ action: "next" })}>{enc.active ? "Next turn ▶" : "Start combat ▶"}</button>
          {enc.active && <button type="button" className="btn" onClick={() => act({ action: "end" })}>End combat</button>}
          <button type="button" className="btn ghost" onClick={async () => {
            if (await confirm("Remove all monsters and NPCs from the tracker? (Party members stay.)", { label: "Clear" })) void act({ action: "clear" });
          }}>Clear</button>
        </div>
      </div>
      <div className="encounter-status">
        {enc.active ? (
          <><span className="tag crit">Round {enc.round}</span><span> Up now: <strong>{current?.name || "—"}</strong></span></>
        ) : <span className="muted">Not in combat. Add combatants, roll initiative, then start.</span>}
        {monsterXp > 0 && (
          <span className="muted small"> · Monster XP {monsterXp.toLocaleString()}{pcCount ? ` (${Math.floor(monsterXp / pcCount).toLocaleString()} each for ${pcCount} PCs)` : ""}</span>
        )}
      </div>
      {enc.combatants.length ? (
        <div className="table-wrap">
          <table className="table tracker">
            <thead><tr>{["", "Init", "Name", "AC", "HP", "Damage / heal", "Conditions", ""].map((t, i) => <th key={i}>{t}</th>)}</tr></thead>
            <tbody>
              {enc.combatants.map((c, i) => <CombatantRow key={c.id} c={c} isTurn={enc.active && i === enc.turn} act={act} />)}
            </tbody>
          </table>
        </div>
      ) : <EmptyState title="The battlefield is empty" text="Add the party, monsters from the SRD, or custom NPCs." />}
      {dialog === "party" && <AddPartyDialog party={party} s={s} act={act} onClose={() => setDialog("")} />}
      {dialog === "monster" && <AddMonsterDialog act={act} onClose={() => setDialog("")} />}
      {dialog === "custom" && <AddCustomDialog act={act} onClose={() => setDialog("")} />}
    </>
  );
}

function CombatantRow({ c, isTurn, act }: { c: Combatant; isTurn: boolean; act: Act }) {
  const showStatblock = useStatblock();
  const [amount, setAmount] = useState("");
  const update = (changes: Partial<Combatant>) => act({ action: "update", id: c.id, changes });
  const applyHp = (sign: number) => {
    const n = parseInt(amount, 10);
    if (!n) return;
    setAmount("");
    void act({ action: "hp", id: c.id, amount: sign * n });
  };
  const nameCell = c.srd_id ? (
    <button type="button" className="link strong" onClick={() => showStatblock(c.srd_id, c.name)}>{c.name}</button>
  ) : c.character_id ? (
    <Link to={`/characters/${c.character_id}`} className="strong">{c.name}</Link>
  ) : <strong>{c.name}</strong>;

  return (
    <tr className={`${isTurn ? "turn" : ""} ${c.hp <= 0 && c.max_hp ? "down" : ""} kind-${c.kind}`}>
      <td className="turn-marker">{isTurn ? "▶" : ""}</td>
      <td><NumInput commit value={c.initiative} onChange={(v) => update({ initiative: v })} aria-label="Initiative" /></td>
      <td>
        {nameCell}
        <div className="muted small">{c.kind === "pc" ? "PC" : c.kind === "npc" ? "NPC" : c.notes}{c.init_bonus ? ` · init ${signed(c.init_bonus)}` : ""}</div>
      </td>
      <td><NumInput commit value={c.ac} onChange={(v) => update({ ac: v })} aria-label="Armor class" /></td>
      <td className="hp-cell">
        <div className="hp-text"><strong>{c.hp}</strong> / {c.max_hp}{c.temp_hp > 0 && <span className="tag">+{c.temp_hp} tmp</span>}</div>
        <HpBar current={c.hp} max={c.max_hp || c.hp || 1} />
      </td>
      <td>
        <div className="row gap nowrap">
          <input
            type="number" min={0} className="hp-amt" placeholder="0" aria-label={`HP change for ${c.name}`}
            value={amount} onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyHp(e.shiftKey ? 1 : -1)}
          />
          <button type="button" className="btn small danger" title="Damage (Enter)" onClick={() => applyHp(-1)}>−</button>
          <button type="button" className="btn small ok" title="Heal (Shift+Enter)" onClick={() => applyHp(1)}>+</button>
          <button type="button" className="btn small" title="Temp HP" onClick={() => {
            const n = parseInt(amount, 10);
            if (n >= 0) void update({ temp_hp: n });
          }}>tmp</button>
        </div>
      </td>
      <td><Conditions value={c.conditions} onChange={(v) => update({ conditions: v })} /></td>
      <td><button type="button" className="icon-btn" aria-label={`Remove ${c.name}`} onClick={() => act({ action: "remove", id: c.id })}>✕</button></td>
    </tr>
  );
}

function AddPartyDialog({ party, s, act, onClose }: { party: Character[]; s: Session; act: Act; onClose: () => void }) {
  const inTracker = new Set(s.encounter.combatants.map((c) => c.character_id).filter(Boolean));
  const [picks, setPicks] = useState(() => new Set(party.filter((c) => !inTracker.has(c.id)).map((c) => c.id)));
  const toggle = (id: string, on: boolean) => setPicks((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });
  return (
    <Modal title="Add party members" onClose={onClose} actions={[
      { label: "Cancel" },
      { label: "Add", primary: true, onClick: () => picks.size && act({ action: "add_character", character_ids: [...picks] }) },
    ]}>
      <div className="stack">
        {party.map((c) => (
          <label className="check" key={c.id}>
            <Checkbox checked={picks.has(c.id)} onChange={(v) => toggle(c.id, v)} /> {c.name}
            {inTracker.has(c.id) && <span className="muted small"> (already in tracker)</span>}
          </label>
        ))}
      </div>
    </Modal>
  );
}

function AddMonsterDialog({ act, onClose }: { act: Act; onClose: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SrdEntry[]>([]);
  const [picked, setPicked] = useState("");
  const [count, setCount] = useState(1);
  const [average, setAverage] = useState(true);
  const search = useDebounced((text: string) => {
    const m = text.trim().match(/^cr\s*([\d/]+)$/i);
    api.srdSearch(m ? { category: "monsters", cr_label: m[1], limit: 40 } : { q: text.trim(), category: "monsters", limit: 40 })
      .then((r) => setResults(r.results), (e: Error) => toast(e.message, "error"));
  }, 200);
  useEffect(() => search(q), [q, search]);
  const add = (srdId = picked) => {
    if (!srdId) {
      toast("Pick a monster from the list", "error");
      return false;
    }
    void act({ action: "add_monster", srd_id: srdId, count: count || 1, average_hp: average });
  };
  return (
    <Modal title="Add monsters" onClose={onClose} actions={[{ label: "Cancel" }, { label: "Add", primary: true, onClick: () => add() }]}>
      <div className="stack">
        <input type="search" className="wide" autoFocus placeholder="Search monsters (goblin, dragon, CR 5…)" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="list pick-list">
          {results.map((e) => (
            <li key={e.id}>
              <button type="button" className={`list-link ${picked === e.id ? "selected" : ""}`} onClick={() => setPicked(e.id)} onDoubleClick={() => { add(e.id); onClose(); }}>
                <span className="grow">{e.name}</span>
                <span className="muted small">{e.summary}</span>
                <span className="tag">AC {e.data.ac} · HP {e.data.hp}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="row gap">
          <label className="row gap">Count <NumInput value={count} onChange={setCount} min={1} max={50} aria-label="Count" /></label>
          <label className="check"><Checkbox checked={average} onChange={setAverage} /> Use average HP (untick to roll)</label>
        </div>
      </div>
    </Modal>
  );
}

function AddCustomDialog({ act, onClose }: { act: Act; onClose: () => void }) {
  const toast = useToast();
  const [c, setC] = useState({ name: "", kind: "npc" as CombatantKind, init_bonus: 0, initiative: 0, ac: 10, hp: 10 });
  const set = <K extends keyof typeof c>(k: K) => (v: (typeof c)[K]) => setC((x) => ({ ...x, [k]: v }));
  return (
    <Modal title="Add custom combatant" onClose={onClose} actions={[
      { label: "Cancel" },
      { label: "Add", primary: true, onClick: () => {
        if (!c.name.trim()) {
          toast("Give it a name", "error");
          return false;
        }
        void act({ action: "add", combatant: { ...c, max_hp: c.hp } });
      } },
    ]}>
      <div className="form-grid">
        <Field label="Name"><TextInput value={c.name} onChange={set("name")} placeholder="Bandit captain, ally NPC…" autoFocus /></Field>
        <Field label="Type"><Select value={c.kind} options={[["npc", "NPC"], ["monster", "Monster"], ["pc", "PC (unlinked)"]]} onChange={(v) => set("kind")(v as CombatantKind)} /></Field>
        <Field label="Initiative bonus"><NumInput value={c.init_bonus} onChange={set("init_bonus")} /></Field>
        <Field label="Initiative (0 = roll later)"><NumInput value={c.initiative} onChange={set("initiative")} /></Field>
        <Field label="AC"><NumInput value={c.ac} onChange={set("ac")} /></Field>
        <Field label="HP"><NumInput value={c.hp} onChange={set("hp")} /></Field>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ log

function LogTab({ s, run }: { s: Session; run: Run }) {
  const [kind, setKind] = useState("note");
  const [text, setText] = useState("");
  const [filter, setFilter] = useState("");
  const add = async () => {
    const t = text.trim();
    if (!t) return;
    if (await run(() => api.log(s.id, t, kind))) setText("");
  };
  const remove = (entryId: string) => run(() => api.update("sessions", s.id, { log: s.log.filter((e) => e.id !== entryId) }));
  return (
    <>
      <div className="row gap log-input">
        <Select value={kind} options={LOG_KINDS.map((k): [string, string] => [k, titleCase(k)])} onChange={setKind} aria-label="Entry type" />
        <input type="text" className="grow" autoFocus placeholder="What happened? (Enter to add)" aria-label="Log entry"
          value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button type="button" className="btn primary" onClick={add}>Add</button>
      </div>
      <div className="row gap wrap filter-row">
        <span className="muted small">Show:</span>
        {["", ...LOG_KINDS].map((k) => (
          <button type="button" key={k} className={`chip-btn ${filter === k ? "active" : ""}`} onClick={() => setFilter(k)}>{k ? titleCase(k) : "All"}</button>
        ))}
      </div>
      {s.log.length ? (
        <ul className="log">
          {[...s.log].reverse().filter((e) => !filter || e.kind === filter).map((e) => (
            <li key={e.id} className={`log-entry kind-${e.kind}`}>
              <time className="muted small">{fmtDate(e.time)}</time>
              <span className="tag">{e.kind}</span>
              <span className="grow">{e.text}</span>
              <button type="button" className="icon-btn" aria-label="Delete entry" onClick={() => remove(e.id)}>✕</button>
            </li>
          ))}
        </ul>
      ) : <EmptyState title="Nothing logged yet" text="Jot down events, NPC names and rolls as they happen. Dice-tray rolls can be logged with ✎." />}
    </>
  );
}

// ------------------------------------------------------------------ loot & xp

function LootTab({ s, party, edit, run }: {
  s: Session;
  party: Character[];
  edit: (fn: (d: Session) => void) => void;
  run: Run;
}) {
  const { roll } = useDice();
  const toast = useToast();
  const [xp, setXp] = useState("");
  const [picks, setPicks] = useState(() => new Set(party.map((c) => c.id)));
  const monsterXp = s.encounter.combatants.filter((c) => c.kind === "monster").reduce((a, c) => a + (c.xp || 0), 0);
  const partyOpts: [string, string][] = [["", "— give to —"], ...party.map((c): [string, string] => [c.id, c.name])];
  const setItem = (i: number, patch: Partial<Session["loot"][number]>) => edit((d) => void Object.assign(d.loot[i], patch));

  return (
    <div className="grid-2">
      <section className="panel">
        <div className="panel-head">
          <h2>Loot</h2>
          <div className="row gap">
            <button type="button" className="btn small" onClick={() => roll("d100", "Treasure (d100)")}>🎲 d100</button>
            <button type="button" className="btn small" onClick={() => edit((d) => void d.loot.push({ name: "", qty: 1, value: "", assigned_to: "" }))}>+ Item</button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr>{["Item", "Qty", "Value", "Given to", ""].map((t, i) => <th key={i}>{t}</th>)}</tr></thead>
            <tbody>
              {s.loot.map((item, i) => (
                <tr key={i}>
                  <td><TextInput value={item.name} onChange={(v) => setItem(i, { name: v })} aria-label="Item" /></td>
                  <td><NumInput value={item.qty} onChange={(v) => setItem(i, { qty: v })} aria-label="Quantity" /></td>
                  <td><TextInput value={item.value} onChange={(v) => setItem(i, { value: v })} placeholder="50 gp" aria-label="Value" /></td>
                  <td>
                    {item.assigned_to ? <span className="tag">{item.assigned_to}</span> : (
                      <Select value="" options={partyOpts} aria-label="Give to character" onChange={async (cid) => {
                        if (!cid) return;
                        if (await run(() => api.award(s.id, { loot_index: i, character_id: cid }))) toast("Added to inventory");
                      }} />
                    )}
                  </td>
                  <td><button type="button" className="icon-btn" aria-label="Remove item" onClick={() => edit((d) => void d.loot.splice(i, 1))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!s.loot.length && <p className="muted">No loot recorded yet.</p>}
      </section>
      <section className="panel">
        <h2>Experience</h2>
        <p>XP awarded this session: <strong>{s.xp_awarded}</strong> per character</p>
        {monsterXp > 0 && (
          <p className="muted small">Monsters in the tracker are worth {monsterXp.toLocaleString()} XP in total{party.length ? ` (${Math.floor(monsterXp / party.length).toLocaleString()} each for ${party.length})` : ""}.</p>
        )}
        {party.length ? (
          <>
            <div className="stack">
              {party.map((c) => (
                <label className="check" key={c.id}>
                  <Checkbox checked={picks.has(c.id)} onChange={(v) => setPicks((p) => { const n = new Set(p); if (v) n.add(c.id); else n.delete(c.id); return n; })} />
                  {" "}{c.name} <span className="muted small">({c.xp.toLocaleString()} XP)</span>
                </label>
              ))}
            </div>
            <div className="row gap">
              <input type="number" min={0} placeholder="XP each" className="num-input wide-num" aria-label="XP per character" value={xp} onChange={(e) => setXp(e.target.value)} />
              <button type="button" className="btn primary" onClick={async () => {
                const n = parseInt(xp, 10);
                if (!n) return toast("Enter an XP amount", "error");
                if (await run(() => api.award(s.id, { xp: n, character_ids: [...picks] }))) toast(`Awarded ${n} XP`);
              }}>Award XP</button>
            </div>
          </>
        ) : <p className="muted">Link characters to this campaign to award XP.</p>}
      </section>
    </div>
  );
}
