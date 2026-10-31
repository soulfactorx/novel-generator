import { costOf, dayKey, priceFor, type Price } from "./pricing";
import type { Usage } from "./providers/types";
import type { ProviderId } from "./types";

export type UsageKind = "chat" | "memory" | "outline" | "episode" | "diagnose" | "cover" | "test";
export const KIND_LABEL: Record<UsageKind, string> = { chat: "이야기 대화", memory: "장기 기억 정리", outline: "소설 개요", episode: "소설 집필", diagnose: "진단", cover: "표지 그림", test: "연결 테스트" };

export interface UsageRow {
  n: number; // 호출 수
  in: number;
  out: number;
  cr: number;
  cw: number;
  usd: number; // 단가를 아는 호출의 비용 합
  unpriced: number; // 단가를 몰라 비용에서 빠진 호출 수
}
export interface UsageData {
  v: 1;
  /** day → "provider|model" → 집계, 그리고 "@kind" → 집계 */
  days: Record<string, Record<string, UsageRow>>;
}
export const emptyUsage = (): UsageData => ({ v: 1, days: {} });
const KEEP_DAYS = 400;
const zero = (): UsageRow => ({ n: 0, in: 0, out: 0, cr: 0, cw: 0, usd: 0, unpriced: 0 });

/** 한 번의 AI 호출을 집계에 더한다 (불변 갱신). 반환: 새 데이터와 이번 호출 비용(모르면 null) */
export function recordUsage(data: UsageData, e: { provider: ProviderId; model: string; kind: UsageKind; usage: Usage; date?: Date; custom?: Record<string, Price> }): { data: UsageData; usd: number | null } {
  const day = dayKey(e.date);
  const u = e.usage;
  const price = priceFor(e.provider, e.model, { date: day, promptTokens: u.input + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0), custom: e.custom });
  const usd = price ? costOf(u, price) : null;
  const add = (r: UsageRow = zero()): UsageRow => ({ n: r.n + 1, in: r.in + u.input, out: r.out + u.output, cr: r.cr + (u.cacheRead ?? 0), cw: r.cw + (u.cacheWrite ?? 0), usd: r.usd + (usd ?? 0), unpriced: r.unpriced + (usd === null ? 1 : 0) });
  const d = { ...(data.days[day] ?? {}) };
  const mk = `${e.provider}|${e.model}`;
  d[mk] = add(d[mk]);
  d["@" + e.kind] = add(d["@" + e.kind]);
  const days = { ...data.days, [day]: d };
  const keys = Object.keys(days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete days[k];
  return { data: { v: 1, days }, usd };
}

export interface UsageSummary {
  total: UsageRow;
  models: { provider: string; model: string; row: UsageRow }[];
  kinds: { kind: UsageKind; row: UsageRow }[];
  daily: { day: string; usd: number; n: number }[];
}
const sum = (a: UsageRow, b: UsageRow): UsageRow => ({ n: a.n + b.n, in: a.in + b.in, out: a.out + b.out, cr: a.cr + b.cr, cw: a.cw + b.cw, usd: a.usd + b.usd, unpriced: a.unpriced + b.unpriced });

/** from~to(포함) 기간 요약 */
export function summarize(data: UsageData, from: string, to: string): UsageSummary {
  let total = zero();
  const models: Record<string, UsageRow> = {};
  const kinds: Record<string, UsageRow> = {};
  const daily: UsageSummary["daily"] = [];
  for (const [day, rows] of Object.entries(data.days).sort(([a], [b]) => a.localeCompare(b))) {
    if (day < from || day > to) continue;
    let dayUsd = 0,
      dayN = 0;
    for (const [k, r] of Object.entries(rows)) {
      if (k.startsWith("@")) kinds[k.slice(1)] = sum(kinds[k.slice(1)] ?? zero(), r);
      else {
        models[k] = sum(models[k] ?? zero(), r);
        total = sum(total, r);
        dayUsd += r.usd;
        dayN += r.n;
      }
    }
    daily.push({ day, usd: dayUsd, n: dayN });
  }
  return {
    total,
    models: Object.entries(models).map(([k, row]) => ({ provider: k.split("|")[0], model: k.split("|").slice(1).join("|"), row })).sort((a, b) => b.row.usd - a.row.usd || b.row.n - a.row.n),
    kinds: Object.entries(kinds).map(([kind, row]) => ({ kind: kind as UsageKind, row })).sort((a, b) => b.row.usd - a.row.usd || b.row.n - a.row.n),
    daily,
  };
}

export function rangeDays(days: number, now = new Date()): [string, string] {
  const from = new Date(now);
  from.setDate(from.getDate() - (days - 1));
  return [dayKey(from), dayKey(now)];
}
export const monthRange = (now = new Date()): [string, string] => [dayKey(new Date(now.getFullYear(), now.getMonth(), 1)), dayKey(now)];
