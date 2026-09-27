import { useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { NumInput, Select } from "../components/ui";
import { useApp } from "../context/app";
import { HistoryItem, useDice } from "../context/dice";
import { useDialogs } from "../context/ui";
import { modOf, profBonus, signed } from "../lib/util";

const DICE = [4, 6, 8, 10, 12, 20, 100];

export function Tools() {
  return (
    <>
      <header className="page-head"><h1>Dice &amp; Calculator</h1></header>
      <div className="grid-2">
        <div><Roller /><Macros /></div>
        <div><Calculator /><History /></div>
      </div>
      <h2 className="section-title">Quick calculators</h2>
      <div className="cards calc-cards">
        <AbilityCalc /><PointBuy /><EncounterXp /><XpLevel /><CoinCalc /><SpellDc />
      </div>
    </>
  );
}

// ------------------------------------------------------------------ dice

function buildExpression(pool: Record<number, number>, mod: number, mode: string) {
  const parts: string[] = [];
  for (const sides of [...DICE].reverse()) {
    const n = pool[sides];
    if (!n) continue;
    if (sides === 20 && mode !== "normal") {
      parts.push(`2d20${mode === "adv" ? "kh1" : "kl1"}`);
      if (n > 1) parts.push(`${n - 1}d20`);
    } else parts.push(`${n}d${sides}`);
  }
  let e = parts.join("+");
  if (mod) e += `${mod < 0 ? "-" : e ? "+" : ""}${Math.abs(mod)}`;
  return e;
}

function Roller() {
  const { roll, macros, setMacros } = useDice();
  const { prompt } = useDialogs();
  const [pool, setPool] = useState<Record<number, number>>({});
  const [mod, setMod] = useState(0);
  const [mode, setMode] = useState("normal");
  const [expr, setExpr] = useState("");
  const [times, setTimes] = useState(1);

  const change = (nextPool: Record<number, number>, nextMod: number, nextMode: string) => {
    setPool(nextPool);
    setMod(nextMod);
    setMode(nextMode);
    setExpr(buildExpression(nextPool, nextMod, nextMode));
  };
  const go = async () => {
    const e = expr.trim();
    if (!e) return;
    for (let i = 0; i < Math.max(1, Math.min(20, times || 1)); i++) await roll(e);
  };
  const saveMacro = async () => {
    const label = await prompt("Save as macro", { label: "Name", value: expr });
    if (label && expr.trim()) setMacros([...macros, { label, expr: expr.trim() }]);
  };

  return (
    <section className="panel">
      <h2>Dice roller</h2>
      <div className="die-row big">
        {DICE.map((s) => (
          <button
            type="button" key={s} className="die-btn" title={`Add a d${s} (right-click removes)`}
            onClick={() => change({ ...pool, [s]: (pool[s] || 0) + 1 }, mod, mode)}
            onContextMenu={(ev) => { ev.preventDefault(); change({ ...pool, [s]: Math.max(0, (pool[s] || 0) - 1) }, mod, mode); }}
          >
            d{s}<span className="die-count">{pool[s] || ""}</span>
          </button>
        ))}
      </div>
      <div className="row gap wrap">
        <span>Modifier</span>
        <button type="button" className="btn small" aria-label="Decrease modifier" onClick={() => change(pool, mod - 1, mode)}>−</button>
        <strong>{signed(mod)}</strong>
        <button type="button" className="btn small" aria-label="Increase modifier" onClick={() => change(pool, mod + 1, mode)}>+</button>
        <Select aria-label="Roll mode" value={mode} options={[["normal", "Normal"], ["adv", "Advantage (d20)"], ["dis", "Disadvantage (d20)"]]} onChange={(v) => change(pool, mod, v)} />
        <button type="button" className="btn small ghost" onClick={() => change({}, 0, mode)}>Clear</button>
      </div>
      <div className="row gap">
        <input type="text" className="wide expr" aria-label="Dice expression" placeholder="Click dice or type: 4d6dl1, 2d20kh1+5, 8d6…"
          value={expr} onChange={(e) => setExpr(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
      </div>
      <div className="row gap">
        <button type="button" className="btn primary big-btn" onClick={go}>🎲 Roll</button>
        <label className="row gap small">× <NumInput min={1} max={20} aria-label="Number of times" value={times} onChange={setTimes} /></label>
        <button type="button" className="btn" onClick={saveMacro}>Save macro</button>
      </div>
      <details className="help">
        <summary>Dice syntax</summary>
        <ul className="small">
          <li><code>2d20kh1</code> keep highest (advantage) · <code>2d20kl1</code> keep lowest · shorthand <code>adv+5</code> / <code>dis</code></li>
          <li><code>4d6dl1</code> drop lowest (<code>stats</code> works too) · <code>dh</code> drop highest</li>
          <li><code>3d6!</code> exploding dice · <code>2d6ro2</code> reroll 1–2 once (Great Weapon Fighting) · <code>r1</code> reroll 1s until not 1</li>
          <li><code>d%</code> percentile · <code>4dF</code> Fate dice</li>
          <li>Math: <code>+ − × / // % ^ ( )</code> and <code>floor ceil round abs min max sqrt mod(score) prof(level)</code></li>
          <li>Press <kbd>R</kbd> anywhere to open the quick roller.</li>
        </ul>
      </details>
    </section>
  );
}

function Macros() {
  const { roll, macros, setMacros } = useDice();
  return (
    <section className="panel">
      <h2>Macros</h2>
      <div className="macro-grid">
        {macros.map((m, i) => (
          <div className="macro" key={i}>
            <button type="button" className="btn" title={m.expr} onClick={() => roll(m.expr, m.label)}>{m.label}<span className="muted small"> {m.expr}</span></button>
            <button type="button" className="icon-btn" aria-label={`Delete ${m.label}`} onClick={() => setMacros(macros.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
      </div>
      <p className="muted small">Macros are saved in this browser.</p>
    </section>
  );
}

function History() {
  const { history, clearHistory } = useDice();
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Roll history</h2>
        <button type="button" className="btn small ghost" onClick={clearHistory}>Clear</button>
      </div>
      <ul className="roll-list tall">
        {history.slice(0, 50).map((r) => <HistoryItem key={r.time + r.expression} r={r} />)}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ calculator

const KEYS = [
  ["C", "(", ")", "⌫"],
  ["7", "8", "9", "÷"],
  ["4", "5", "6", "×"],
  ["1", "2", "3", "−"],
  ["0", ".", "d", "+"],
  ["//", "%", "^", "="],
].flat();
const FNS = ["floor(", "ceil(", "round(", "min(", "max(", "abs(", "mod(", "prof(", ","];

function Calculator() {
  const [display, setDisplay] = useState("");
  const [result, setResult] = useState(" ");
  const [tape, setTape] = useState<{ expr: string; total: number; dice: boolean }[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const evaluate = async () => {
    const e = display.trim();
    if (!e) return;
    try {
      const r = await api.roll(e.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-"));
      setResult(`= ${r.total}`);
      setTape((t) => [{ expr: e, total: r.total, dice: r.groups.length > 0 }, ...t]);
      setDisplay(String(r.total));
    } catch (err) {
      setResult((err as Error).message);
    }
  };
  const press = (k: string) => {
    if (k === "C") {
      setDisplay("");
      setResult(" ");
    } else if (k === "⌫") setDisplay((d) => d.slice(0, -1));
    else if (k === "=") return void evaluate();
    else setDisplay((d) => d + k);
    input.current?.focus();
  };

  return (
    <section className="panel">
      <h2>Calculator</h2>
      <input
        ref={input} type="text" className="calc-display" placeholder="0" aria-label="Calculator input" autoComplete="off"
        value={display} onChange={(e) => setDisplay(e.target.value)}
        onKeyDown={(ev) => {
          if (ev.key === "Enter" || ev.key === "=") { ev.preventDefault(); void evaluate(); }
          if (ev.key === "Escape") { setDisplay(""); setResult(" "); }
        }}
      />
      <div className="calc-result" aria-live="polite">{result}</div>
      <div className="keypad">
        {KEYS.map((k) => (
          <button type="button" key={k} className={`key ${k === "=" ? "primary" : ""} ${"÷×−+//%^".includes(k) ? "op" : ""}`} onClick={() => press(k)}>{k}</button>
        ))}
      </div>
      <div className="row gap wrap fn-row">
        {FNS.map((f) => <button type="button" key={f} className="chip-btn" onClick={() => press(f)}>{f}</button>)}
      </div>
      <p className="muted small">
        Type freely — dice work here too (e.g. <code>floor(8d6/2)</code>). <code>/</code> is exact division; <code>//</code> rounds down like the rules do.
      </p>
      <ul className="calc-tape">
        {tape.map((t, i) => (
          <li key={i}>
            <button type="button" className="link" onClick={() => { setDisplay(String(t.total)); input.current?.focus(); }}>{t.expr} = {t.total}</button>
            {t.dice && <span className="muted small"> (dice)</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ D&D quick calcs

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <section className="panel calc-card"><h3>{title}</h3>{children}</section>;
}

function AbilityCalc() {
  const [score, setScore] = useState(10);
  return (
    <Card title="Ability modifier">
      <div className="row gap">
        <label className="row gap">Score <NumInput min={1} max={30} value={score} onChange={setScore} /></label>
        <span>→</span>
        <strong className="big-num">{signed(modOf(score))}</strong>
      </div>
      <p className="muted small">Modifier = (score − 10) ÷ 2, rounded down.</p>
    </Card>
  );
}

function PointBuy() {
  const { meta } = useApp();
  const cost: Record<number, number> = meta?.point_buy?.cost || { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
  const [scores, setScores] = useState([8, 8, 8, 8, 8, 8]);
  const spent = scores.reduce((t, s) => t + cost[s], 0);
  const bump = (i: number, by: number) => setScores((s) => s.map((v, j) => (j === i ? Math.min(15, Math.max(8, v + by)) : v)));
  return (
    <Card title="Point buy">
      <div className="stack">
        {["STR", "DEX", "CON", "INT", "WIS", "CHA"].map((a, i) => (
          <div className="row gap" key={a}>
            <span className="abbr">{a}</span>
            <button type="button" className="btn small" aria-label={`Lower ${a}`} onClick={() => bump(i, -1)}>−</button>
            <strong className="num-cell">{scores[i]}</strong>
            <button type="button" className="btn small" aria-label={`Raise ${a}`} onClick={() => bump(i, 1)}>+</button>
            <span className="muted small">{signed(modOf(scores[i]))} · cost {cost[scores[i]]}</span>
          </div>
        ))}
      </div>
      <strong className={spent > 27 ? "bad" : spent === 27 ? "good" : ""}>{spent} / 27 points</strong>
    </Card>
  );
}

function EncounterXp() {
  const { meta } = useApp();
  const crXp = meta?.cr_xp || {};
  const [rows, setRows] = useState([{ cr: "1", n: 1 }]);
  const [party, setParty] = useState(4);
  const xp = rows.reduce((t, r) => t + (crXp[r.cr] || 0) * (Number(r.n) || 0), 0);
  const setRow = (i: number, patch: Partial<{ cr: string; n: number }>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <Card title="Encounter XP">
      <div className="stack">
        {rows.map((r, i) => (
          <div className="row gap" key={i}>
            <NumInput className="num-input tiny" min={0} aria-label="Count" value={r.n} onChange={(v) => setRow(i, { n: v })} />
            <span>× CR</span>
            <Select aria-label="Challenge rating" value={r.cr} options={Object.keys(crXp)} onChange={(v) => setRow(i, { cr: v })} />
            <button type="button" className="icon-btn" aria-label="Remove" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button type="button" className="link small" onClick={() => setRows((rs) => [...rs, { cr: "1", n: 1 }])}>+ Add monsters</button>
      </div>
      <label className="row gap">Party size <NumInput className="num-input tiny" min={1} value={party} onChange={(v) => setParty(v || 1)} /></label>
      <p>Total <strong>{xp.toLocaleString()}</strong> XP · <strong>{Math.floor(xp / (party || 1)).toLocaleString()}</strong> each for {party} PCs</p>
    </Card>
  );
}

function XpLevel() {
  const { meta } = useApp();
  const table = meta?.xp_by_level || [];
  const [xp, setXp] = useState(0);
  let lvl = 1;
  table.forEach((need, i) => { if (xp >= need) lvl = i + 1; });
  const next = table[lvl];
  return (
    <Card title="XP → level">
      <label className="row gap">Experience <NumInput min={0} value={xp} onChange={setXp} /></label>
      <p>Level <strong>{lvl}</strong> · proficiency {signed(profBonus(lvl))}{next ? ` · ${(next - xp).toLocaleString()} XP to level ${lvl + 1}` : " · max level"}</p>
    </Card>
  );
}

const RATES = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 };
type CoinKey = keyof typeof RATES;

function coinBreakdown(n: number) {
  const parts: string[] = [];
  for (const k of ["pp", "gp", "sp", "cp"] as CoinKey[]) {
    const q = Math.floor(n / RATES[k]);
    if (q) parts.push(`${q} ${k}`);
    n -= q * RATES[k];
  }
  return parts.join(", ") || "0";
}

function CoinCalc() {
  const [coins, setCoins] = useState<Record<CoinKey, number>>({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
  const [split, setSplit] = useState(1);
  const cp = (Object.keys(coins) as CoinKey[]).reduce((t, k) => t + (coins[k] || 0) * RATES[k], 0);
  const each = Math.floor(cp / (split || 1));
  return (
    <Card title="Coins & splitting loot">
      <div className="row gap wrap">
        {(Object.keys(coins) as CoinKey[]).map((k) => (
          <label className="field coin" key={k}><span>{k.toUpperCase()}</span><NumInput min={0} value={coins[k]} onChange={(v) => setCoins((c) => ({ ...c, [k]: v }))} /></label>
        ))}
      </div>
      <label className="row gap">Split between <NumInput className="num-input tiny" min={1} value={split} onChange={(v) => setSplit(Math.max(1, v))} /></label>
      <p>Total <strong>{(cp / 100).toLocaleString()} gp</strong> ({coinBreakdown(cp)})</p>
      {split > 1 && (
        <p>Each of {split}: <strong>{coinBreakdown(each)}</strong>{cp % split ? <span className="muted small"> · {cp - each * split} cp left over</span> : null}</p>
      )}
    </Card>
  );
}

function SpellDc() {
  const [score, setScore] = useState(16);
  const [level, setLevel] = useState(5);
  const pb = profBonus(level);
  const m = modOf(score);
  return (
    <Card title="Spell save DC">
      <div className="row gap wrap">
        <label className="row gap">Ability score <NumInput className="num-input tiny" value={score} onChange={setScore} /></label>
        <label className="row gap">Level <NumInput className="num-input tiny" min={1} max={20} value={level} onChange={setLevel} /></label>
      </div>
      <p>Save DC <strong>{8 + pb + m}</strong> · Spell attack <strong>{signed(pb + m)}</strong></p>
      <p className="muted small">DC = 8 + proficiency + modifier.</p>
    </Card>
  );
}
