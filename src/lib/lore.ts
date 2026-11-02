import type { LoreEntry } from "./types";

/** "등불, 마력등 / 가로등" → ["등불","마력등","가로등"] */
export function parseKeys(s: string): string[] {
  return [...new Set(s.split(/[,，、/\n]/).map((k) => k.trim()).filter(Boolean))];
}

export interface LoreHit {
  entry: LoreEntry;
  source: string; // 세계관·인물 이름
  matched?: string;
}

export interface LoreScan {
  /** 최근 메시지들(오래된 것 → 최근). 주면 @@scan_depth 를 메시지 단위로 적용, 없으면 text 전체 */
  messages?: string[];
  /** 대화 길이(첫 메시지 포함) — @@activate_only_after · @@activate_only_every */
  chatLength?: number;
  /** 기본 검색 깊이(메시지 수) */
  scanDepth?: number;
  /** 활성화된 로어 내용으로 다시 검색 (RisuAI 재귀 검색, 기본 켜짐) */
  recursive?: boolean;
  /** 확률 데코레이터용 난수 (테스트에서 고정) */
  random?: () => number;
}

/* ---------------- 키 검사 (RisuAI searchMatch 규칙) ---------------- */
const norm = (s: string) => s.toLocaleLowerCase().replace(/\{\{\/\/(.+?)\}\}/g, "").replace(/\{\{comment:(.+?)\}\}/g, "");
/** 키 하나라도(또는 all이면 전부) 텍스트에 있으면 그 키를 돌려준다 */
function search(texts: string[], keys: string[], o: { regex?: boolean; fullWord?: boolean; all?: boolean }): string | null {
  const ks = keys.map((k) => k.trim()).filter(Boolean);
  if (!ks.length) return null;
  if (o.regex) {
    for (const k of ks) {
      const m = /^\/([\s\S]*)\/([dgimsuvy]*)$/.exec(k);
      if (!m) return null;
      let re: RegExp;
      try {
        re = new RegExp(m[1], m[2]);
      } catch {
        return null;
      }
      for (const t of texts) {
        re.lastIndex = 0;
        if (re.test(t)) return k;
      }
    }
    return null;
  }
  let first: string | null = null;
  let allOk = true;
  for (const raw of texts) {
    const t = norm(raw);
    const words = o.fullWord ? t.split(/\s+/) : null;
    const flat = t.replace(/ /g, "");
    for (const k of ks) {
      const hit = words ? words.includes(k.toLocaleLowerCase()) : flat.includes(k.toLocaleLowerCase().replace(/ /g, ""));
      if (hit) {
        first ??= k;
        if (!o.all) return k;
      } else if (o.all) allOk = false;
    }
  }
  return o.all && allOk ? first ?? ks[0] : o.all ? null : first;
}

/* ---------------- 데코레이터 ---------------- */
interface Deco {
  force?: "activate" | "deactivate";
  blocked: boolean;
  scanDepth?: number;
  fullWord?: boolean;
  priority?: number;
  queries: { keys: string[]; negative: boolean; all?: boolean }[];
  recursive?: boolean;
  noRecursiveSearch?: boolean;
}
function decorators(e: LoreEntry, scan: LoreScan): Deco {
  const d: Deco = { blocked: false, queries: [] };
  const len = scan.chatLength ?? Infinity;
  for (const line of (e.decorators ?? "").split("\n")) {
    const m = /^@@@?([a-z_]+)\s*(.*)$/i.exec(line.trim());
    if (!m) continue;
    const name = m[1].toLowerCase();
    const args = m[2].split(",").map((a) => a.trim()).filter(Boolean);
    const int = parseInt(args[0]);
    switch (name) {
      case "activate_only_after":
        if (!isNaN(int) && len < int) d.blocked = true;
        break;
      case "activate_only_every":
        if (!isNaN(int) && int > 0 && len % int !== 0) d.blocked = true;
        break;
      case "probability":
        if (!isNaN(int) && (scan.random ?? Math.random)() * 100 > int) d.blocked = true;
        break;
      case "activate":
        d.force = "activate";
        break;
      case "dont_activate":
        d.force = "deactivate";
        break;
      case "additional_keys":
        d.queries.push({ keys: args, negative: false });
        break;
      case "exclude_keys":
        d.queries.push({ keys: args, negative: true });
        break;
      case "exclude_keys_all":
        d.queries.push({ keys: args, negative: true, all: true });
        break;
      case "match_full_word":
        d.fullWord = true;
        break;
      case "match_partial_word":
        d.fullWord = false;
        break;
      case "scan_depth":
        if (!isNaN(int)) d.scanDepth = int;
        break;
      case "priority":
        if (!isNaN(int)) d.priority = int;
        break;
      case "ignore_on_max_context":
        d.priority = -1000;
        break;
      case "recursive":
        d.recursive = true;
        break;
      case "unrecursive":
        d.recursive = false;
        break;
      case "no_recursive_search":
        d.noRecursiveSearch = true;
        break;
    }
  }
  return d;
}

/**
 * 최근 대화에 키워드가 나온 항목(또는 '항상' 항목)을 고른다. RisuAI 로어북 규칙:
 * 보조 키(둘 다 나와야), 정규식 키, 데코레이터(@@activate_only_after · @@probability · @@exclude_keys …),
 * 재귀 검색(활성화된 로어 내용으로 다시 검색). 글자 예산을 넘으면 우선순위(order·@@priority) 낮은 것부터 뺀다.
 */
export function matchLore(groups: { source: string; entries: LoreEntry[] }[], text: string, budget = 4000, scan: LoreScan = {}): LoreHit[] {
  const all = groups.flatMap((g) => g.entries.map((entry) => ({ entry, source: g.source })));
  const messages = scan.messages?.length ? scan.messages : [text];
  const depth = scan.scanDepth ?? messages.length;
  const recursiveOn = scan.recursive ?? true;
  const hits: (LoreHit & { pri: number })[] = [];
  const done = new Set<LoreEntry>();
  const recursiveTexts: string[] = [];
  for (let pass = 0; pass < 10; pass++) {
    let found = false;
    for (const { entry: e, source } of all) {
      if (done.has(e) || !e.enabled || !e.content.trim()) continue;
      if (!e.always && !e.keys.length && !e.decorators?.includes("activate")) continue;
      const d = decorators(e, scan);
      const pri = d.priority ?? e.order ?? 0;
      if (d.force === "deactivate") {
        done.add(e);
        continue;
      }
      let ok = !d.blocked;
      let matched: string | undefined;
      if (ok && d.force !== "activate" && !e.always) {
        const base = messages.slice(Math.max(0, messages.length - (d.scanDepth ?? depth)));
        const texts = d.noRecursiveSearch ? base : [...base, ...recursiveTexts];
        const queries = [{ keys: e.keys, negative: false }, ...(e.secondKeys?.length ? [{ keys: e.secondKeys, negative: false }] : []), ...d.queries];
        for (const q of queries) {
          const r = search(texts, q.keys, { regex: e.regex && q === queries[0], fullWord: d.fullWord, all: q.all });
          if (q.negative ? r !== null : r === null) {
            ok = false;
            break;
          }
          if (!q.negative && q === queries[0]) matched = r ?? undefined;
        }
      }
      if (!ok) {
        if (d.blocked) done.add(e); // 조건이 대화 길이·확률이면 이번에는 다시 보지 않음
        continue;
      }
      done.add(e);
      found = true;
      hits.push({ entry: e, source, ...(matched ? { matched } : {}), pri });
      if (recursiveOn && d.recursive !== false) recursiveTexts.push(e.content);
    }
    if (!found || !recursiveOn) break;
  }
  // '항상' 먼저, 그다음 우선순위 높은 순 (같으면 등장 순)
  const ordered = hits.map((h, i) => ({ h, i })).sort((a, b) => Number(!!b.h.entry.always) - Number(!!a.h.entry.always) || b.h.pri - a.h.pri || a.i - b.i).map((x) => x.h);
  const out: LoreHit[] = [];
  let used = 0;
  for (const { pri: _p, ...h } of ordered) {
    const n = h.entry.title.length + h.entry.content.length;
    if (used + n > budget && out.length) continue;
    out.push(h);
    used += n;
  }
  return out;
}

export function formatLore(hits: LoreHit[]): string {
  return hits.map((h) => `- ${h.entry.title || h.entry.keys[0] || "설정"}${h.source ? ` (${h.source})` : ""}: ${h.entry.content.trim()}`).join("\n");
}
