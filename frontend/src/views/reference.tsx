import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { EmptyState, LoadError, Loading, Markdown, NumInput, Select, type Option } from "../components/ui";
import { useApp } from "../context/app";
import { Modal, useToast } from "../context/ui";
import { useDebounced, useLoad, usePref } from "../lib/hooks";
import type { Character, HandbookEntry, SrdCategory, SrdEntry, SrdMeta } from "../types";

const SCHOOLS = ["", "Abjuration", "Conjuration", "Divination", "Enchantment", "Evocation", "Illusion", "Necromancy", "Transmutation"];
const CASTERS = ["", "Bard", "Cleric", "Druid", "Paladin", "Ranger", "Sorcerer", "Warlock", "Wizard"];
const CRS = ["", "0", "1/8", "1/4", "1/2", ...Array.from({ length: 30 }, (_, i) => String(i + 1))];
const TYPES = ["", "aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "swarm of Tiny beasts", "undead"];
const RARITIES = ["", "Common", "Uncommon", "Rare", "Very Rare", "Legendary", "Artifact", "Varies"];

const FILTERS: Record<string, { key: string; label: string; options: Option[] }[]> = {
  spells: [
    { key: "level", label: "Spell level", options: [["", "Any level"], ["0", "Cantrip"], ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((l): Option => [String(l), `Level ${l}`])] },
    { key: "classes", label: "Class", options: CASTERS.map((c): Option => [c, c || "Any class"]) },
    { key: "school", label: "School", options: SCHOOLS.map((c): Option => [c, c || "Any school"]) },
    { key: "ritual", label: "Ritual", options: [["", "Ritual?"], ["true", "Ritual only"], ["false", "Not ritual"]] },
    { key: "concentration", label: "Concentration", options: [["", "Concentration?"], ["true", "Concentration"], ["false", "No concentration"]] },
  ],
  monsters: [
    { key: "cr_label", label: "Challenge rating", options: CRS.map((c): Option => [c, c ? `CR ${c}` : "Any CR"]) },
    { key: "type", label: "Creature type", options: TYPES.map((c): Option => [c, c || "Any type"]) },
  ],
  "magic-items": [{ key: "rarity", label: "Rarity", options: RARITIES.map((c): Option => [c, c || "Any rarity"]) }],
};

let categoriesCache: Promise<{ categories: SrdCategory[]; meta: SrdMeta }> | null = null;

export function Reference() {
  const splat = useParams()["*"] || "";
  const parts = splat.split("/").filter(Boolean);
  const category = parts[0] || "";
  const openId = parts.length > 1 ? parts.join("/") : "";
  const { data, error } = useLoad(() => (categoriesCache ??= api.srdCategories()), []);
  if (error) return <LoadError error={error} />;
  if (!data) return <Loading />;
  const labelFor = (cat: string) => data.categories.find((c) => c.id === cat)?.label || cat;

  return (
    <>
      <header className="page-head"><h1>{category ? labelFor(category) : "Rules & SRD"}</h1></header>
      <div className={`ref-layout ${openId ? "has-detail" : ""}`}>
        <nav className="ref-cats" aria-label="Categories">
          <Link to="/reference" className={!category ? "active" : ""}>All</Link>
          {data.categories.map((c) => (
            <Link key={c.id} to={`/reference/${c.id}`} className={c.id === category ? "active" : ""}>
              {c.label}<span className="muted small"> {c.count}</span>
            </Link>
          ))}
        </nav>
        <ResultList key={category} category={category} openId={openId} labelFor={labelFor} />
        <div className="ref-detail">
          {openId ? <EntryView key={openId} id={openId} category={category} /> : (
            <EmptyState title="Pick an entry" text="Dice in rules text are clickable — tap “2d6” or “+5 to hit” to roll." />
          )}
        </div>
      </div>
      <p className="muted small attribution">{data.meta.attribution}</p>
    </>
  );
}

function ResultList({ category, openId, labelFor }: { category: string; openId: string; labelFor: (c: string) => string }) {
  const toast = useToast();
  const [query, setQuery] = usePref(`ref.q.${category}`, "");
  const [filters, setFilters] = usePref<Record<string, string>>(`ref.filters.${category}`, {});
  const [results, setResults] = useState<SrdEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [handbook, setHandbook] = useState<HandbookEntry[]>([]);
  const request = useRef(0);

  const run = async (q: string, f: Record<string, string>, offset = 0) => {
    const n = ++request.current;
    try {
      const res = await api.srdSearch({ q: q.trim(), category, limit: 60, offset, ...f });
      if (n !== request.current) return; // a newer search superseded this one
      setResults((prev) => (offset ? [...prev, ...res.results] : res.results));
      setTotal(res.total);
      // Your own handbook entries show alongside SRD results.
      if (!offset && q.trim() && !category) {
        const needle = q.trim().toLowerCase();
        const hb = await api.list("handbook");
        setHandbook(hb.filter((e) => `${e.title} ${e.body} ${e.tags.join(" ")}`.toLowerCase().includes(needle)));
      } else if (!offset) setHandbook([]);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const debounced = useDebounced(run, 200);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void run(query, filters), [filters]);

  return (
    <div className="ref-list">
      <input
        type="search" className="wide" aria-label="Search"
        placeholder={category ? `Search ${labelFor(category)}…` : "Search all rules, spells, monsters, items…"}
        value={query}
        onChange={(e) => { setQuery(e.target.value); debounced(e.target.value, filters); }}
      />
      {FILTERS[category] && (
        <div className="row gap wrap filter-row">
          {FILTERS[category].map((f) => (
            <Select key={f.key} aria-label={f.label} value={filters[f.key] ?? ""} options={f.options} onChange={(v) => setFilters({ ...filters, [f.key]: v })} />
          ))}
        </div>
      )}
      <div className="row gap"><span className="muted small">{total} result{total === 1 ? "" : "s"}</span></div>
      {handbook.length > 0 && (
        <div>
          <h3 className="small-head">Your handbook</h3>
          <ul className="list">
            {handbook.slice(0, 8).map((e) => (
              <li key={e.id}><Link className="list-link" to={`/handbook/${e.id}`}><span className="grow">{e.title}</span><span className="tag">{e.category}</span></Link></li>
            ))}
          </ul>
        </div>
      )}
      <ul className="list results">
        {results.map((e) => (
          <li key={e.id}>
            <Link className={`list-link ${e.id === openId ? "selected" : ""}`} to={`/reference/${e.id}`}>
              <span className="grow">{e.name}</span>
              {!category && <span className="tag">{labelFor(e.category)}</span>}
              <span className="muted small">{e.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
      {results.length < total && <button type="button" className="btn small" onClick={() => run(query, filters, results.length)}>Load more</button>}
    </div>
  );
}

function EntryView({ id, category }: { id: string; category: string }) {
  const { data: e, error } = useLoad(() => api.srdEntry(id), [id]);
  const [dialog, setDialog] = useState<"" | "monster" | "spell" | "item">("");
  const close = useCallback(() => setDialog(""), []);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => ref.current?.scrollIntoView({ block: "nearest" }), [e]);
  if (error) return <EmptyState title="Not found" text={error.message} />;
  if (!e) return <Loading />;
  return (
    <article className="panel entry" ref={ref}>
      <Link className="small back-link" to={`/reference/${category}`}>← Back to results</Link>
      <h2>{e.name}</h2>
      {e.summary && <p className="muted">{e.summary}</p>}
      <div className="row gap wrap">
        {e.category === "monsters" && <button type="button" className="btn primary small" onClick={() => setDialog("monster")}>⚔️ Add to encounter</button>}
        {e.category === "spells" && <button type="button" className="btn small" onClick={() => setDialog("spell")}>+ Add to a character</button>}
        {(e.category === "equipment" || e.category === "magic-items") && (
          <button type="button" className="btn small" onClick={() => setDialog("item")}>+ Give to a character</button>
        )}
      </div>
      <Markdown source={e.body || ""} rollContext={e.name} />
      {dialog === "monster" && <AddMonster e={e} onClose={close} />}
      {(dialog === "spell" || dialog === "item") && <AddToCharacter e={e} what={dialog} onClose={close} />}
    </article>
  );
}

function AddMonster({ e, onClose }: { e: SrdEntry; onClose: () => void }) {
  const { sessionId } = useApp();
  const toast = useToast();
  const [count, setCount] = useState(1);
  useEffect(() => {
    if (!sessionId) {
      toast("Open a session first — the monster goes into its encounter", "error");
      onClose();
    }
  }, [sessionId, toast, onClose]);
  if (!sessionId) return null;
  return (
    <Modal title={`Add ${e.name}`} onClose={onClose} actions={[
      { label: "Cancel" },
      { label: "Add", primary: true, onClick: async () => {
        try {
          await api.encounter(sessionId, { action: "add_monster", srd_id: e.id, count: count || 1 });
          toast("Added to encounter");
        } catch (err) {
          toast((err as Error).message, "error");
        }
      } },
    ]}>
      <label className="row gap">How many? <NumInput min={1} max={50} value={count} onChange={setCount} /></label>
    </Modal>
  );
}

function AddToCharacter({ e, what, onClose }: { e: SrdEntry; what: "spell" | "item"; onClose: () => void }) {
  const { campaignId } = useApp();
  const toast = useToast();
  const [chars, setChars] = useState<Character[] | null>(null);
  const [pick, setPick] = useState("");
  useEffect(() => {
    api.list("characters", { campaign_id: campaignId }).then((list) => {
      if (!list.length) {
        toast("No characters yet", "error");
        onClose();
      }
      setChars(list);
      setPick(list[0]?.id || "");
    });
  }, [campaignId, toast, onClose]);
  if (!chars?.length) return null;
  return (
    <Modal title={what === "spell" ? `Add ${e.name} to…` : `Give ${e.name} to…`} onClose={onClose} actions={[
      { label: "Cancel" },
      { label: "Add", primary: true, onClick: async () => {
        try {
          const ch = await api.get("characters", pick);
          if (what === "spell") {
            await api.update("characters", pick, {
              spellcasting: { ...ch.spellcasting, spells: [...ch.spellcasting.spells, { name: e.name, level: e.data.level, prepared: false, notes: e.summary, srd_id: e.id }] },
            });
          } else {
            await api.update("characters", pick, {
              inventory: [...ch.inventory, { name: e.name, qty: 1, weight: e.data.weight || 0, equipped: false, notes: e.summary || "" }],
            });
          }
          toast(`Added to ${ch.name}`);
        } catch (err) {
          toast((err as Error).message, "error");
        }
      } },
    ]}>
      <Select value={pick} options={chars.map((c): Option => [c.id, c.name])} onChange={setPick} />
    </Modal>
  );
}
