/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import { buildCoverPrompt, coverPalette, dataUrlToBytes, generateCoverImage, parseImageResponse, wrapTitle } from "../src/lib/cover";
import { novelToEpub } from "../src/lib/exporters";
import { priceFor } from "../src/lib/pricing";
import { normalizeNovel, type Novel } from "../src/lib/types";
import { json, mockFetch } from "./helpers";

afterEach(() => vi.unstubAllGlobals());
const novel = (o: Partial<Novel> = {}) => normalizeNovel({ id: "n", title: "비의 항구", author: "도윤", genre: "미스터리", brief: "밀수 사건을 쫓는 신입 조사관", characterIds: [], episodeCount: 1, episodeLength: "medium", outline: [], episodes: [{ id: "e", title: "1화", text: "본문", summary: "", createdAt: 0, updatedAt: 0 }], createdAt: 0, updatedAt: 0, ...o });

describe("cover", () => {
  test("prompt: story context, no text, always all-ages", () => {
    const p = buildCoverPrompt(novel(), { world: { kind: "world", id: "w", name: "레인포트", description: "비가 그치지 않는 항구", rules: "", lore: [], createdAt: 0, updatedAt: 0 }, characters: [{ kind: "character", id: "c", name: "서율", summary: "감찰관", profile: "", speech: "", lore: [], createdAt: 0, updatedAt: 0 }] });
    for (const x of ["Genre: 미스터리", "밀수 사건", "Setting: 레인포트", "서율 (감찰관)", "Do not include any text", "Safe for all ages"]) expect(p).toContain(x);
  });
  test("API request shape (Interactions, 2:3 JPEG) + response parsing + usage", async () => {
    const calls = mockFetch(json({ status: "completed", steps: [{ type: "thought", content: [] }, { type: "model_output", content: [{ type: "text", text: "here" }, { type: "image", data: "QUJD", mime_type: "image/jpeg" }] }], usage: { total_input_tokens: 120, total_output_tokens: 1120, total_thought_tokens: 30 } }));
    const r = await generateCoverImage({ key: "gk", model: "gemini-nano-banana-2.1", prompt: "p" });
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(calls[0].headers["x-goog-api-key"]).toBe("gk");
    expect(calls[0].body).toEqual({ model: "gemini-nano-banana-2.1", input: "p", response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "2:3", image_size: "1K" } });
    expect(r).toMatchObject({ mime: "image/jpeg", base64: "QUJD", usage: { input: 120, output: 1150 } });
    expect(() => parseImageResponse({ steps: [{ type: "model_output", content: [{ type: "text", text: "거절" }] }] })).toThrow("그림이 돌아오지 않았습니다");
    await expect(generateCoverImage({ key: "", model: "m", prompt: "p" })).rejects.toThrow("Gemini API 키");
    mockFetch(json({ error: { message: "API key not valid" } }, 403));
    await expect(generateCoverImage({ key: "x", model: "m", prompt: "p" })).rejects.toThrow("API 키를 확인");
  });
  test("image pricing ≈ $0.034 per 1K image", () => {
    const p = priceFor("gemini", "gemini-nano-banana-2.1")!;
    expect((1120 * p.out) / 1e6).toBeCloseTo(0.0336, 4);
    expect(priceFor("gemini", "gemini-3.1-flash-lite-image")!.out).toBe(30); // 접두어가 텍스트 모델(flash-lite)로 잘못 잡히지 않음
  });
  test("title wrapping, deterministic palette, data URL decoding", () => {
    expect(wrapTitle("비가 그치지 않는 항구 도시의 밤", 8)).toEqual(["비가 그치지", "않는 항구", "도시의 밤"]); // 공백 0.55 포함 폭 8 이내
    expect(wrapTitle("비의 항구", 8)).toEqual(["비의 항구"]);
    expect(wrapTitle("아주아주아주아주긴한단어", 5)).toEqual(["아주아주아", "주아주긴한", "단어"]);
    expect(wrapTitle("하나 둘 셋 넷 다섯 여섯 일곱 여덟", 3, 2)).toHaveLength(2);
    expect(coverPalette("미스터리|비의 항구")).toEqual(coverPalette("미스터리|비의 항구"));
    expect(dataUrlToBytes("data:image/png;base64,QUJD")).toEqual({ mime: "image/png", bytes: new Uint8Array([65, 66, 67]) });
  });
  test("EPUB includes cover image + cover page + both cover metadata styles", () => {
    const buf = novelToEpub(novel({ cover: { dataUrl: "data:image/jpeg;base64,/9j/AAAA", source: "design", createdAt: 0 } }));
    const text = new TextDecoder("latin1").decode(buf);
    expect(text).toContain('properties="cover-image"');
    expect(text).toContain('<meta name="cover" content="cover-image"/>');
    expect(text).toContain('<itemref idref="cover" linear="yes"/>');
    expect(text).toContain("OEBPS/cover.jpg");
    expect(new TextDecoder("latin1").decode(novelToEpub(novel()))).not.toContain("cover-image");
  });
});

describe("PWA files", () => {
  const pub = (p: string) => new URL(`../public/${p}`, import.meta.url);
  test("manifest is valid and its icons exist with the declared sizes", () => {
    const m = JSON.parse(readFileSync(pub("manifest.webmanifest"), "utf8"));
    expect(m).toMatchObject({ display: "standalone", start_url: "./", scope: "./" });
    expect(m.icons.some((i: { purpose: string }) => i.purpose === "maskable")).toBe(true);
    for (const i of m.icons) {
      const b = readFileSync(pub(i.src));
      const [w, h] = [b.readUInt32BE(16), b.readUInt32BE(20)];
      expect(`${w}x${h}`).toBe(i.sizes);
    }
  });
  test("service worker only handles same-origin GET; core files exist; index.html links them", () => {
    const sw = readFileSync(pub("sw.js"), "utf8");
    expect(sw).toContain('if (req.method !== "GET") return;');
    expect(sw).toContain("if (url.origin !== self.location.origin) return;");
    for (const f of [...sw.matchAll(/"\.\/([^"]+)"/g)].map((m) => m[1]).filter(Boolean)) expect(existsSync(pub(f)), f).toBe(true);
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    expect(html).toContain('rel="manifest" href="manifest.webmanifest"');
    expect(html).toContain('name="theme-color"');
  });
});
