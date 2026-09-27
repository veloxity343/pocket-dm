// Small formatting and browser helpers shared by every view.

import type { Ability } from "../types";

export const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
export const ABILITY_NAMES: Record<Ability, string> = {
  str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma",
};

export const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
export const modOf = (score: number | string) => Math.floor((Number(score || 10) - 10) / 2);
export const profBonus = (level: number) => 2 + Math.floor((Math.min(Math.max(level, 1), 20) - 1) / 4);
export const titleCase = (s: string) => String(s).replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
export const slug = (s: string, fallback = "export") =>
  String(s).replace(/\W+/g, "-").replace(/^-|-$/g, "").toLowerCase() || fallback;
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const today = () => new Date().toISOString().slice(0, 10);

export function fmtDate(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function hpLevel(pct: number) {
  return pct > 50 ? "ok" : pct > 25 ? "warn" : "bad";
}

export function download(filename: string, text: string, type = "application/json") {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

export const downloadJson = (filename: string, data: unknown) => download(filename, JSON.stringify(data, null, 2));

export interface PickedFile {
  name: string;
  text: string;
}

export function pickFiles({ accept = "", multiple = false } = {}): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = "none";
    input.addEventListener("change", async () => {
      const files = await Promise.all([...(input.files || [])].map(async (f) => ({ name: f.name, text: await f.text() })));
      input.remove();
      resolve(files);
    });
    document.body.append(input);
    input.click();
  });
}

// ------------------------------------------------------------------ browser-local preferences

const KEY = (k: string) => `pocketdm.${k}`;

export function readPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(KEY(key));
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(KEY(key), JSON.stringify(value));
  } catch {
    /* storage unavailable: preferences just won't persist */
  }
}
