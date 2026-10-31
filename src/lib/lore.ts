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

/**
 * 최근 대화에 키워드가 등장한 항목(또는 '항상' 항목)을 고른다.
 * 글자 예산을 넘으면 '항상' → 먼저 등장한 순으로 잘라낸다.
 */
export function matchLore(groups: { source: string; entries: LoreEntry[] }[], text: string, budget = 4000): LoreHit[] {
  const hay = text.toLowerCase();
  const hits: LoreHit[] = [];
  for (const g of groups)
    for (const e of g.entries) {
      if (!e.enabled || !e.content.trim()) continue;
      if (e.always) hits.push({ entry: e, source: g.source });
      else {
        const k = e.keys.find((k) => k && hay.includes(k.toLowerCase()));
        if (k) hits.push({ entry: e, source: g.source, matched: k });
      }
    }
  hits.sort((a, b) => Number(!!b.entry.always) - Number(!!a.entry.always));
  const out: LoreHit[] = [];
  let used = 0;
  for (const h of hits) {
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
