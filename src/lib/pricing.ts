import type { Usage } from "./providers/types";
import type { ProviderId } from "./types";

/** USD / 100만 토큰 */
export interface Price {
  in: number;
  out: number;
  cacheRead?: number;
  cacheWrite?: number;
}
/** 기간별 단가: until(포함, YYYY-MM-DD)까지 적용, 마지막 항목은 이후 계속 */
type Schedule = (Price & { until?: string })[];

/** platform.claude.com/docs/en/about-claude/pricing (2026-10-31 확인) — [입력, 출력, 캐시 저장(5분), 캐시 적중] */
const C = (i: number, o: number, w: number, r: number): Price => ({ in: i, out: o, cacheWrite: w, cacheRead: r });
const CLAUDE: Record<string, Price> = {
  "claude-fable-5-1": C(10, 50, 12.5, 0.25),
  "claude-opus-5-5": C(4, 20, 5, 0.2),
  "claude-sonnet-5-5": C(2, 10, 2.5, 0.1),
  "claude-haiku-5-5": C(0.1, 0.5, 0.125, 0.01),
  "claude-opus-5": C(5, 25, 6.25, 0.5),
  "claude-sonnet-5": C(2, 10, 2.5, 0.2),
  "claude-opus-4-8": C(5, 25, 6.25, 0.5),
  "claude-opus-4-7": C(5, 25, 6.25, 0.5),
  "claude-opus-4-6": C(5, 25, 6.25, 0.5),
  "claude-opus-4-5": C(5, 25, 6.25, 0.5),
  "claude-sonnet-4-6": C(3, 15, 3.75, 0.3),
  "claude-sonnet-4-5": C(3, 15, 3.75, 0.3),
  "claude-haiku-4-5": C(1, 5, 1.25, 0.1),
};
/** 프롬프트 10만 토큰 초과 시 단가 */
const CLAUDE_LONG: Record<string, Price> = { "claude-haiku-5-5": C(0.5, 2.5, 0.625, 0.05) };

/** ai.google.dev/gemini-api/docs/pricing (2026-10-31 확인, Standard·텍스트) — 암시적 캐시는 저장 비용 없음 */
const G = (i: number, o: number, r: number, until?: string) => ({ in: i, out: o, cacheRead: r, ...(until ? { until } : {}) });
const GEMINI: Record<string, Schedule> = {
  "gemini-4-argon": [G(2, 10, 0.1, "2026-11-30"), G(4, 20, 0.2)],
  "gemini-3.8-flash": [G(0.75, 3.75, 0.075, "2026-12-31"), G(1.5, 7.5, 0.15)],
  "gemini-3.6-flash": [G(0.75, 3.75, 0.075, "2026-12-31"), G(1.5, 7.5, 0.15)],
  "gemini-3.5-flash-lite": [G(0.3, 2.5, 0.03)],
  "gemini-3.1-flash-lite": [G(0.25, 1.5, 0.025)],
};

export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const bare = (model: string) => model.replace(/^models\//, "").replace(/-\d{8}$/, "");

/** 단가 찾기. custom(사용자 지정)이 우선. 모르는 모델은 null */
export function priceFor(provider: ProviderId, model: string, opts: { date?: string; promptTokens?: number; custom?: Record<string, Price> } = {}): Price | null {
  const id = bare(model);
  const custom = opts.custom?.[model] ?? opts.custom?.[id];
  if (custom && (custom.in > 0 || custom.out > 0)) return custom;
  if (provider === "anthropic") return ((opts.promptTokens ?? 0) > 100_000 && CLAUDE_LONG[id]) || CLAUDE[id] || null;
  if (provider === "gemini") {
    // 정확히 일치 → 가장 긴 접두어 (예: gemini-3.8-flash-preview-xx)
    const key = GEMINI[id] ? id : Object.keys(GEMINI).filter((k) => id.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    if (!key) return null;
    const date = opts.date ?? dayKey();
    return GEMINI[key].find((p) => !p.until || date <= p.until) ?? null;
  }
  return null;
}

export function costOf(u: Usage, p: Price): number {
  return (u.input * p.in + u.output * p.out + (u.cacheRead ?? 0) * (p.cacheRead ?? p.in) + (u.cacheWrite ?? 0) * (p.cacheWrite ?? p.in)) / 1e6;
}

export function formatUsd(v: number): string {
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}
export const formatTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
