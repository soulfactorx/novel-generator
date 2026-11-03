import { describe, expect, test } from "vitest";
import { costOf, formatUsd, priceFor } from "../src/lib/pricing";
import { emptyUsage, monthRange, rangeDays, recordUsage, summarize } from "../src/lib/usage";
import { buildEpisodeDiagnosis, buildRoomDiagnosis, splitDiagnosis } from "../src/lib/diagnose";
import { memoryMaxBatch, pendingForMemory } from "../src/lib/memory";
const MEMORY_MAX_BATCH = memoryMaxBatch();
import { DEFAULT_SETTINGS, normalizeNovel, normalizeSettings, type Room } from "../src/lib/types";

describe("pricing", () => {
  test("Claude: table, date suffix, long-context Haiku, unknown", () => {
    expect(priceFor("anthropic", "claude-sonnet-5-5")).toMatchObject({ in: 2, out: 10, cacheRead: 0.1, cacheWrite: 2.5 });
    expect(priceFor("anthropic", "claude-haiku-4-5-20251001")).toMatchObject({ in: 1, out: 5 });
    expect(priceFor("anthropic", "claude-haiku-5-5", { promptTokens: 150_000 })).toMatchObject({ in: 0.5, out: 2.5 });
    expect(priceFor("anthropic", "claude-unknown-9")).toBeNull();
  });
  test("Gemini: dated schedules and prefix match", () => {
    expect(priceFor("gemini", "gemini-3.8-flash", { date: "2026-12-31" })).toMatchObject({ in: 0.75, out: 3.75 });
    expect(priceFor("gemini", "gemini-3.8-flash", { date: "2027-01-01" })).toMatchObject({ in: 1.5, out: 7.5 });
    expect(priceFor("gemini", "gemini-4-argon", { date: "2026-12-01" })).toMatchObject({ in: 4, out: 20 });
    expect(priceFor("gemini", "models/gemini-3.5-flash-lite-preview-11-2026")).toMatchObject({ in: 0.3, out: 2.5 });
  });
  test("custom price wins; OpenAI-compatible unknown without it", () => {
    expect(priceFor("openai", "deepseek/x")).toBeNull();
    expect(priceFor("openai", "deepseek/x", { custom: { "deepseek/x": { in: 0.5, out: 1 } } })).toEqual({ in: 0.5, out: 1 });
    expect(priceFor("anthropic", "claude-sonnet-5-5", { custom: { "claude-sonnet-5-5": { in: 0, out: 0 } } })).toMatchObject({ in: 2 });
  });
  test("cost math", () => {
    const p = priceFor("anthropic", "claude-sonnet-5-5")!;
    // 1M input $2 + 0.5M output $5 + 2M cache read $0.2 + 0.1M cache write $0.25
    expect(costOf({ input: 1e6, output: 5e5, cacheRead: 2e6, cacheWrite: 1e5 }, p)).toBeCloseTo(7.45, 6);
    expect(formatUsd(0.00123)).toBe("$0.0012");
    expect(formatUsd(1.5)).toBe("$1.50");
  });
});

describe("usage log", () => {
  test("record + summarize by model, kind, day; unpriced counted", () => {
    let d = emptyUsage();
    const day1 = new Date(2026, 9, 30, 10), day2 = new Date(2026, 9, 31, 10);
    d = recordUsage(d, { provider: "anthropic", model: "claude-sonnet-5-5", kind: "chat", usage: { input: 1e6, output: 0 }, date: day1 }).data;
    const r = recordUsage(d, { provider: "openai", model: "x", kind: "episode", usage: { input: 10, output: 10 }, date: day2 });
    expect(r.usd).toBeNull();
    d = recordUsage(r.data, { provider: "anthropic", model: "claude-sonnet-5-5", kind: "episode", usage: { input: 0, output: 1e5 }, date: day2 }).data;
    const s = summarize(d, "2026-10-01", "2026-10-31");
    expect(s.total).toMatchObject({ n: 3, unpriced: 1 });
    expect(s.total.usd).toBeCloseTo(3, 6);
    expect(s.models[0]).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5" });
    expect(s.kinds.find((k) => k.kind === "episode")!.row.n).toBe(2);
    expect(s.daily.map((x) => x.day)).toEqual(["2026-10-30", "2026-10-31"]);
    expect(summarize(d, "2026-10-31", "2026-10-31").total.n).toBe(2);
  });
  test("ranges", () => {
    expect(rangeDays(7, new Date(2026, 9, 31))).toEqual(["2026-10-25", "2026-10-31"]);
    expect(monthRange(new Date(2026, 9, 31))).toEqual(["2026-10-01", "2026-10-31"]);
  });
  test("old days pruned", () => {
    let d = emptyUsage();
    for (let i = 0; i < 405; i++) d = recordUsage(d, { provider: "openai", model: "x", kind: "chat", usage: { input: 1, output: 1 }, date: new Date(2025, 0, 1 + i) }).data;
    expect(Object.keys(d.days)).toHaveLength(400);
  });
});

describe("diagnosis", () => {
  const room: Room = { id: "r", title: "t", premise: "추가", memory: "기억", characterIds: [], createdAt: 0, updatedAt: 0, messages: [{ id: "1", role: "user", text: "간다", createdAt: 1 }, { id: "2", role: "assistant", text: "장면", createdAt: 2 }] };
  test("room request + split", () => {
    const q = buildRoomDiagnosis(DEFAULT_SETTINGS, room, { characters: [] });
    expect(q.system).toContain("### 설정·인물 일관성");
    expect(q.system).toContain("기억");
    expect(q.messages[0].content).toContain("[사용자] 간다\n\n[AI] 장면");
    expect(splitDiagnosis("### 한 줄 평\n- 좋음\n\n[다음 지시]\n대화를 늘려라.")).toEqual({ report: "### 한 줄 평\n- 좋음", directive: "대화를 늘려라." });
    expect(splitDiagnosis("보고서만").directive).toBe("");
  });
  test("episode request includes outline and text", () => {
    const n = normalizeNovel({ id: "n", title: "", author: "", genre: "", brief: "기획", characterIds: [], episodeCount: 2, episodeLength: "medium", outline: [{ id: "a", title: "A", summary: "사건A" }], episodes: [{ id: "e", title: "A", text: "원고A", summary: "", createdAt: 0, updatedAt: 0 }], createdAt: 0, updatedAt: 0 });
    const u = buildEpisodeDiagnosis(DEFAULT_SETTINGS, n, { characters: [] }, 0).messages[0].content;
    expect(u).toContain("1화 「A」\n사건A");
    expect(u).toContain("원고A");
  });
});

test("memory batches are capped", () => {
  const msgs = Array.from({ length: 300 }, (_, i) => ({ id: "m" + i, role: (i % 2 ? "assistant" : "user") as "user" | "assistant", text: "x", createdAt: i + 1 }));
  const p = pendingForMemory({ id: "r", title: "", premise: "", memory: "", characterIds: [], createdAt: 0, updatedAt: 0, messages: msgs }, 40, "auto");
  expect(p).toHaveLength(MEMORY_MAX_BATCH);
  expect(p[0].id).toBe("m0");
});

test("settings normalization for new fields", () => {
  const s = normalizeSettings({ fallback: { enabled: true }, monthlyBudget: -5, customPrices: null });
  expect(s.fallback).toEqual({ enabled: true, provider: "gemini", model: "gemini-3.8-flash" });
  expect(s.monthlyBudget).toBe(0);
  expect(s.customPrices).toEqual({});
});
