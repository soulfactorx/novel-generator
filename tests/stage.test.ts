// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { renderRisu, sanitizeHtml, sniffMedia, type ImagePool } from "../src/lib/images";
import { normalizeOnboarding } from "../src/lib/risu";
import type { ImageMeta } from "../src/lib/types";

const meta = (id: string, name: string, kind: ImageMeta["kind"] = "asset", mime = "image/png"): ImageMeta => ({ id, ownerId: "c", name, kind, mime, size: 1, createdAt: 0, updatedAt: 0 });
const pool = (o: Partial<ImagePool> = {}): ImagePool => ({
  assets: [meta("a1", "숲"), meta("a2", "theme", "asset", "audio/mpeg"), meta("a3", "intro", "asset", "video/mp4")],
  emotions: [meta("e1", "joy", "emotion"), meta("e2", "sad", "emotion")],
  scripts: [],
  emotionMode: false,
  emotionPanel: false,
  ...o,
});

describe("화면 연출 (RisuAI 미디어 태그)", () => {
  test("소리·영상·배경 음악", () => {
    const r = renderRisu("{{audio::theme}}\n{{video::intro}}\n{{bgm::theme}}\n{{asset::theme}}", pool());
    expect(r.html).toContain('<audio src="nvimg:a2" controls autoplay loop>');
    expect(r.html).toContain('<video src="nvimg:a3" controls');
    expect(r.html).toContain('risu-ctrl="bgm___auto___nvimg:a2"');
    expect(r.html).toContain('<audio src="nvimg:a2" controls></audio>');
  });
  test("{{bg::}} 는 배경 화면에서만 그림이 된다", () => {
    expect(renderRisu("{{bg::숲}}", pool()).html).toBe("");
    const back = renderRisu("{{bg::숲}}", pool(), undefined, "back");
    expect(back.html).toContain('class="risu-bgimg"');
    expect(back.ids).toEqual(["a1"]);
    const out = sanitizeHtml(back.html, { a1: "blob:x/1" }, "sc");
    expect(out).toContain("url(blob:x/1)");
  });
  test("감정 옆 패널: 본문에서 빼고 이름을 돌려준다", () => {
    const inline = renderRisu("{{emotion::joy}}안녕", pool());
    expect(inline.html).toContain('src="nvimg:e1"');
    const side = renderRisu("{{emotion::joy}}안녕 {{emotion::sad}}", pool({ emotionPanel: true }));
    expect(side.html).not.toContain("nvimg");
    expect(side.emotions).toEqual(["joy", "sad"]);
  });
  test("소리·영상 파일 형식 알아내기", () => {
    const b = (s: string, pad = 16) => new Uint8Array([...s].map((c) => c.charCodeAt(0)).concat(Array(pad).fill(0)));
    expect(sniffMedia(b("ID3"))).toBe("audio/mpeg");
    expect(sniffMedia(b("OggS"))).toBe("audio/ogg");
    expect(sniffMedia(b("RIFF\0\0\0\0WAVE"))).toBe("audio/wav");
    expect(sniffMedia(b("\0\0\0\x18ftypisom"), "mp4")).toBe("video/mp4");
    expect(sniffMedia(b("\0\0\0\x18ftypM4A "), "m4a")).toBe("audio/mp4");
  });
  test("폼 컨트롤과 미디어는 남기고 외부 주소는 막는다", () => {
    const out = sanitizeHtml('<form risu-form="setup"><input name="lang" value="1"><select name="s"><option value="a">A</option></select><button type="submit">시작</button></form><audio src="https://evil/x.mp3"></audio><video src="nvimg:v"></video>', { v: "blob:x/2" });
    expect(out).toContain('risu-form="setup"');
    expect(out).toContain('<input name="lang" value="1">');
    expect(out).toContain("<select");
    expect(out).not.toContain("evil");
    expect(out).toContain('src="blob:x/2"');
  });
});

describe("온보딩 (RisuAI 시작 설정)", () => {
  test("질문형 온보딩 정리", () => {
    const o = normalizeOnboarding({ enabled: true, mode: "form", title: "설정", questions: [{ id: "l", title: "언어", type: "single", varName: "dmt_first_lang", options: [{ label: "한국어", value: "0" }, { label: "English", value: "1" }] }] });
    expect(o?.questions[0]).toMatchObject({ varName: "dmt_first_lang", type: "single", options: [{ label: "한국어", value: "0" }, { label: "English", value: "1" }] });
    expect(o?.mode).toBe("form");
  });
  test("비어 있으면 없음", () => {
    expect(normalizeOnboarding({ enabled: true, questions: [] })).toBeUndefined();
    expect(normalizeOnboarding(null)).toBeUndefined();
  });
});
