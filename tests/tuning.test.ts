import { afterEach, expect, test } from "vitest";
import { cleanTuning, setTuning, T, TUNE_DEFS } from "../src/lib/tuning";
import { outputTokensFor } from "../src/lib/prompt";
import { episodeLength } from "../src/lib/novel";
import { pendingForMemory } from "../src/lib/memory";
import { DEFAULT_SETTINGS, normalizeSettings, type Room } from "../src/lib/types";

afterEach(() => setTuning({}));

test("수치 정의: id 중복 없음, 기본값이 범위 안", () => {
  expect(new Set(TUNE_DEFS.map((d) => d.id)).size).toBe(TUNE_DEFS.length);
  for (const d of TUNE_DEFS) expect(d.def >= d.min && d.def <= d.max, d.id).toBe(true);
});
test("바꾼 값이 실제로 쓰이고, 범위를 벗어나면 범위 안으로, 기본값으로 되돌리면 원래대로", () => {
  expect(outputTokensFor(DEFAULT_SETTINGS)).toBe(3500);
  setTuning({ "chat.tokens.medium": 5000, "novel.chars.short": 2500, "memory.batch": 3 });
  expect(outputTokensFor(DEFAULT_SETTINGS)).toBe(5000);
  expect(episodeLength("short")).toMatchObject({ chars: 2500, label: "짧게 (약 2,500자)" });
  const room: Room = { id: "r", title: "t", premise: "", memory: "", messages: Array.from({ length: 13 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? "assistant" : "user", text: "x", createdAt: i })) as Room["messages"], createdAt: 0, updatedAt: 0, characterIds: [] };
  expect(pendingForMemory(room, 10, "auto")).toHaveLength(3); // 자동 정리 기준 3
  setTuning({ "net.retries": 99 });
  expect(T("net.retries")).toBe(6);
  setTuning({});
  expect(T("chat.tokens.medium")).toBe(3500);
});
test("저장 정리: 모르는 id·숫자 아닌 값·기본값과 같은 값은 빼고, 범위는 맞춤", () => {
  expect(cleanTuning({ "chat.loreBudget": "8000", "chat.tokens.short": 1500, "없는.id": 3, "memory.batch": "abc", "image.quality": 500 })).toEqual({ "chat.loreBudget": 8000, "image.quality": 100 });
  expect(normalizeSettings({ tuning: { "diagnose.recent": 30 } }).tuning).toEqual({ "diagnose.recent": 30 });
});
