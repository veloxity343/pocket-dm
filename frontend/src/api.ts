// Typed wrappers around the FastAPI JSON API.

import type {
  Character, ClassLevel, EncounterAction, ImportSummary, Kind, KindMap, Meta, RollResult, Session,
  SrdCategory, SrdEntry, SrdMeta, HandbookEntry,
} from "./types";

type Params = Record<string, string | number | boolean | undefined | null>;

function errorMessage(data: unknown, res: Response): string {
  const detail = (data as { detail?: unknown })?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    // FastAPI request validation errors
    return detail.map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc || []).slice(1).join(".")}: ${d.msg}`).join("; ");
  }
  return `${res.status} ${res.statusText}`;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api/${path}`, opts);
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { detail: text };
  }
  if (!res.ok) throw new Error(errorMessage(data, res));
  return data as T;
}

export const qs = (params: Params = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export interface SrdSearchResult {
  total: number;
  results: SrdEntry[];
}

export const api = {
  meta: () => request<Meta>("GET", "meta"),
  list: <K extends Kind>(kind: K, params?: { campaign_id?: string }) =>
    request<Record<K, KindMap[K][]>>("GET", `${kind}${qs(params)}`).then((r) => r[kind]),
  get: <K extends Kind>(kind: K, id: string) => request<KindMap[K]>("GET", `${kind}/${id}`),
  create: <K extends Kind>(kind: K, data: Partial<KindMap[K]> = {}) => request<KindMap[K]>("POST", kind, data),
  update: <K extends Kind>(kind: K, id: string, data: Partial<KindMap[K]>) => request<KindMap[K]>("PUT", `${kind}/${id}`, data),
  remove: (kind: Kind, id: string) => request<{ deleted: string }>("DELETE", `${kind}/${id}`),
  roll: (expression: string) => request<RollResult>("POST", "roll", { expression }),
  stats: () => request<{ results: RollResult[] }>("POST", "stats"),
  slots: (classes: ClassLevel[]) => request<{ slots: number[] }>("POST", "slots", { classes }).then((r) => r.slots),
  encounter: (sessionId: string, action: EncounterAction) => request<Session>("POST", `sessions/${sessionId}/encounter`, action),
  award: (sessionId: string, body: { xp: number; character_ids: string[] } | { loot_index: number; character_id: string }) =>
    request<Session>("POST", `sessions/${sessionId}/award`, body),
  log: (sessionId: string, text: string, kind = "note") => request<Session>("POST", `sessions/${sessionId}/log`, { text, kind }),
  rest: (charId: string, type: "short" | "long") => request<Character>("POST", `characters/${charId}/rest`, { type }),
  srdCategories: () => request<{ categories: SrdCategory[]; meta: SrdMeta }>("GET", "srd/categories"),
  srdSearch: (params: Params) => request<SrdSearchResult>("GET", `srd/search${qs(params)}`),
  srdEntry: (id: string) => request<SrdEntry>("GET", `srd/entry${qs({ id })}`),
  exportAll: (campaign_id?: string) => request<unknown>("GET", `export${qs({ campaign_id })}`),
  exportOne: (kind: Kind, id: string) => request<unknown>("GET", `export/${kind}/${id}`),
  exportMarkdown: async (kind: Kind, id: string) => {
    const res = await fetch(`/api/export/${kind}/${id}?format=md`);
    if (!res.ok) throw new Error(errorMessage(await res.json().catch(() => ({})), res));
    return res.text();
  },
  importData: (payload: unknown, mode = "overwrite") => request<ImportSummary>("POST", `import${qs({ mode })}`, payload),
  importMarkdown: (files: { filename: string; text: string }[], campaign_id = "") =>
    request<{ created: HandbookEntry[] }>("POST", "import/markdown", { files, campaign_id }),
};
