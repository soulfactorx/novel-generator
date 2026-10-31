import { afterEach, describe, expect, test, vi } from "vitest";
import { generate, ProviderError } from "../src/lib/providers";
import { DEFAULT_SETTINGS, type Settings } from "../src/lib/types";
import { claudeStream, json, mockFetch, sseResponse } from "./helpers";

const S = (p: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, keys: { gemini: "gk", anthropic: "ak", openai: "ok" }, ...p });
const base = { system: "SYS", messages: [{ role: "user" as const, content: "hi" }], maxTokens: 3500 };
afterEach(() => vi.unstubAllGlobals());

describe("Claude", () => {
  test("streaming body: browser header, caching, no temperature on 5.x, thinking allowance", async () => {
    const calls = mockFetch(claudeStream("안녕하세요 여러분"));
    const deltas: string[] = [];
    const r = await generate({ ...base, settings: S({ provider: "anthropic" }), onText: (d) => deltas.push(d), messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }] });
    const b = calls[0].body;
    expect(calls[0].headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(b.model).toBe("claude-sonnet-5-5");
    expect(b.temperature).toBeUndefined();
    expect(b.max_tokens).toBe(3500 + 16000);
    expect(b.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(b.messages[1].content[0].cache_control).toEqual({ type: "ephemeral" });
    expect(r.text).toBe("안녕하세요 여러분");
    expect(deltas.join("")).toBe(r.text);
    expect(r.usage).toMatchObject({ input: 100, output: 42, cacheRead: 50 });
  });
  test("temperature only for models that accept it", async () => {
    const calls = mockFetch(claudeStream("ok"));
    await generate({ ...base, settings: S({ provider: "anthropic", models: { ...DEFAULT_SETTINGS.models, anthropic: "claude-sonnet-4-6" }, temperature: 0.4 }) });
    expect(calls[0].body.temperature).toBe(0.4);
    expect(calls[0].body.max_tokens).toBe(3500);
  });
  test("refusal → ProviderError(kind refusal) with explanation", async () => {
    mockFetch(claudeStream("", { stop: "refusal", details: { category: "cyber", explanation: "declined" } }));
    await expect(generate({ ...base, settings: S({ provider: "anthropic" }) })).rejects.toMatchObject({ kind: "refusal", message: expect.stringContaining("cyber: declined") });
  });
  test("401 → Korean auth message; 529 retried", async () => {
    mockFetch(json({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401));
    await expect(generate({ ...base, settings: S({ provider: "anthropic" }) })).rejects.toThrow("API 키가 올바르지 않습니다");
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 });
    mockFetch(json({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, 529), claudeStream("retry ok"));
    const r = await generate({ ...base, settings: S({ provider: "anthropic" }) });
    expect(r.text).toBe("retry ok");
    vi.useRealTimers();
  });
  test("missing key fails before network", async () => {
    const calls = mockFetch();
    await expect(generate({ ...base, settings: S({ provider: "anthropic", keys: { gemini: "", anthropic: "", openai: "" } }) })).rejects.toBeInstanceOf(ProviderError);
    expect(calls).toHaveLength(0);
  });
});

describe("Gemini", () => {
  test("streams text, skips thought parts, maps usage", async () => {
    const ch = (o: object) => `data: ${JSON.stringify(o)}\r\n\r\n`;
    const calls = mockFetch(sseResponse([ch({ candidates: [{ content: { parts: [{ text: "생각", thought: true }] } }] }), ch({ candidates: [{ content: { parts: [{ text: "본문" }] } }] }), ch({ candidates: [{ content: { parts: [{ text: "입니다" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 3 } })]));
    const r = await generate({ ...base, settings: S({ provider: "gemini" }) });
    expect(calls[0].url).toContain("gemini-3.8-flash:streamGenerateContent?alt=sse&key=gk");
    expect(calls[0].body.systemInstruction.parts[0].text).toBe("SYS");
    expect(calls[0].body.safetySettings).toBeUndefined();
    expect(r).toMatchObject({ text: "본문입니다", thinking: "생각", usage: { input: 10, output: 8 } });
  });
  test("adult rating relaxes safety thresholds; safety block → refusal error", async () => {
    const calls = mockFetch(json({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } }));
    await expect(generate({ ...base, settings: S({ provider: "gemini", streaming: false, contentRating: "adult", adultConfirmed: true }) })).rejects.toMatchObject({ kind: "refusal" });
    expect(calls[0].body.safetySettings[0].threshold).toBe("BLOCK_ONLY_HIGH");
  });
});

describe("OpenAI-compatible", () => {
  test("streaming deltas + reasoning + usage; falls back when streaming is refused", async () => {
    const d = (o: object) => `data: ${JSON.stringify(o)}\n\n`;
    let calls = mockFetch(sseResponse([d({ model: "x", choices: [{ delta: { reasoning: "음" } }] }), d({ choices: [{ delta: { content: "오픈" } }] }), d({ choices: [{ delta: { content: "AI" }, finish_reason: "stop" }] }), d({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 2 } }), "data: [DONE]\n\n"]));
    const r = await generate({ ...base, settings: S({ provider: "openai" }) });
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(calls[0].body.stream_options).toEqual({ include_usage: true });
    expect(r).toMatchObject({ text: "오픈AI", thinking: "음", usage: { input: 7, output: 2 } });
    calls = mockFetch(json({ error: { message: "Your organization must be verified to stream this model." } }, 400), json({ choices: [{ message: { content: "일반" } }] }));
    const r2 = await generate({ ...base, settings: S({ provider: "openai", models: { ...DEFAULT_SETTINGS.models, openai: "gpt-5.6" } }) });
    expect(calls[1].body.stream).toBeUndefined();
    expect(calls[0].body.max_completion_tokens).toBeGreaterThan(3500);
    expect(r2.text).toBe("일반");
  });
});
