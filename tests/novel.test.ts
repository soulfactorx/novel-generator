/// <reference types="node" />
import { crc32 as nodeCrc } from "node:zlib";
import { describe, expect, test } from "vitest";
import { crc32, novelToEpub, novelToTxt, roomToTxt, zip } from "../src/lib/exporters";
import { buildEpisodeRequest, buildOutlineRequest, parseOutline, previewEpisode, splitEpisode } from "../src/lib/novel";
import { parseLegacyBackup } from "../src/lib/importLegacy";
import { DEFAULT_SETTINGS, normalizeNovel, type Novel } from "../src/lib/types";

const novel = (o: Partial<Novel> = {}): Novel =>
  normalizeNovel({ id: "n1", title: "비의 항구", author: "", genre: "미스터리", brief: "밀수 사건", characterIds: [], episodeCount: 3, episodeLength: "medium", outline: [], episodes: [], createdAt: 0, updatedAt: 0, ...o });
const ep = (i: number, text = `본문 ${i}`) => ({ id: "e" + i, title: `제목${i}`, text, summary: `요약${i}`, createdAt: 0, updatedAt: 0 });
const ol = (n: number) => Array.from({ length: n }, (_, i) => ({ id: "o" + i, title: `제목${i + 1}`, summary: `개요${i + 1}` }));

describe("outline parsing", () => {
  test("canonical format", () => {
    expect(parseOutline("[1화] 비 오는 밤\n밀수선 발견.\n끝.\n\n[2화] 조합\n잠입한다.")).toEqual([
      { number: 1, title: "비 오는 밤", summary: "밀수선 발견.\n끝." },
      { number: 2, title: "조합", summary: "잠입한다." },
    ]);
  });
  test("variants: 제N화, markdown headings, bold, '요약:' prefix, title on next line", () => {
    const r = parseOutline("서문은 무시\n## 제 1화: 「첫 출근」\n요약: 도윤이 출근한다.\n**2화 - 밀수선**\n배를 조사한다.\n3화.\n잠입\n조합에 숨어든다.");
    expect(r.map((x) => [x.number, x.title, x.summary])).toEqual([
      [1, "첫 출근", "도윤이 출근한다."],
      [2, "밀수선", "배를 조사한다."],
      [3, "잠입", "조합에 숨어든다."],
    ]);
  });
});

describe("episode text", () => {
  test("splits summary; strips a leading episode heading", () => {
    expect(splitEpisode("3화 잠입\n\n본문 문단.\n\n둘째.\n\n[회차 요약]\n잠입했다.")).toEqual({ text: "본문 문단.\n\n둘째.", summary: "잠입했다." });
    expect(splitEpisode("요약 없는 본문")).toEqual({ text: "요약 없는 본문", summary: "" });
    expect(previewEpisode("본문\n\n[회차")).toBe("본문");
    expect(previewEpisode("본문\n\n[회")).toBe("본문");
    expect(previewEpisode("본문 [그녀]")).toBe("본문 [그녀]");
  });
  test("episode request: outline with marker, previous summaries, tail, lore, note, final-episode instruction", () => {
    const long = "가".repeat(3000) + "끝문장";
    const n = novel({ outline: ol(3), episodes: [ep(0), ep(1, long)] });
    const q = buildEpisodeRequest(DEFAULT_SETTINGS, n, { characters: [] }, 2, { lore: "- 조합: 상인 단체", note: "대화 많이" });
    const u = q.messages[0].content;
    expect(u).toContain("[3화] ◀ 이번 회차 제목3");
    expect(u).toContain("[1화] 제목0: 요약0");
    expect(u).toContain("끝문장");
    expect(u).not.toContain("가".repeat(1600));
    expect(u).toContain("- 조합: 상인 단체");
    expect(u).toContain("대화 많이");
    expect(u).toContain("마지막 회차다");
    expect(u).toContain("약 5,000자");
    expect(q.system).toContain("전체 이용가");
    expect(q.system).not.toContain("사용자가 연기");
  });
  test("outline request keeps earlier episodes when extending", () => {
    const n = novel({ episodeCount: 5, outline: ol(2), episodes: [ep(0), ep(1)] });
    const u = buildOutlineRequest(DEFAULT_SETTINGS, n, { characters: [] }, 2).messages[0].content;
    expect(u).toContain("이미 정해진 회차");
    expect(u).toContain("3화부터 5화까지 3개 회차");
    expect(u).toContain("요약1");
  });
});

/** 최소 ZIP 리더 (중앙 디렉터리 기준) — CRC 는 Node 내장 zlib.crc32 로 독립 검증 */
function unzip(buf: Uint8Array) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eocd = buf.length - 22;
  expect(dv.getUint32(eocd, true)).toBe(0x06054b50);
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: { name: string; text: string; method: number; offset: number }[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    expect(dv.getUint32(p, true)).toBe(0x02014b50);
    const method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nlen));
    expect(dv.getUint32(off, true)).toBe(0x04034b50);
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    const data = buf.subarray(start, start + size);
    expect(nodeCrc(data)).toBe(crc);
    out.push({ name, text: dec.decode(data), method, offset: off });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

describe("export", () => {
  test("crc32 matches zlib", () => {
    const d = new TextEncoder().encode("한글 테스트 123");
    expect(crc32(d)).toBe(nodeCrc(d));
    expect(unzip(zip([{ name: "가.txt", data: "나" }]))[0]).toMatchObject({ name: "가.txt", text: "나" });
  });
  test("EPUB: mimetype first & stored, OPF/nav/ncx consistent, XHTML escaped & well-formed-ish", () => {
    const n = novel({ title: "비 & 항구 <1>", author: "도윤", outline: ol(2), episodes: [ep(0, '첫 문단 "인용" & <태그>\n\n둘째 문단\u0001'), ep(1)] });
    const files = unzip(novelToEpub(n, new Date("2026-10-31T12:00:00Z")));
    expect(files[0]).toMatchObject({ name: "mimetype", text: "application/epub+zip", method: 0, offset: 0 });
    const by = (name: string) => files.find((f) => f.name === name)!.text;
    expect(by("META-INF/container.xml")).toContain('full-path="OEBPS/content.opf"');
    const opf = by("OEBPS/content.opf");
    expect(opf).toContain("<dc:title>비 &amp; 항구 &lt;1&gt;</dc:title>");
    expect(opf).toContain('<meta property="dcterms:modified">2026-10-31T12:00:00Z</meta>');
    expect(opf).toMatch(/urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}/);
    for (const m of opf.matchAll(/href="([^"]+)"/g)) expect(files.some((f) => f.name === "OEBPS/" + m[1])).toBe(true);
    expect(by("OEBPS/nav.xhtml")).toContain('<a href="ch001.xhtml">제1화 제목0</a>');
    expect(by("OEBPS/toc.ncx")).toContain('playOrder="2"');
    const ch = by("OEBPS/ch001.xhtml");
    expect(ch).toContain("<p>첫 문단 &quot;인용&quot; &amp; &lt;태그&gt;</p>");
    expect(ch).not.toContain("\u0001");
    // 같은 소설 → 같은 식별자
    expect(unzip(novelToEpub(n)).find((f) => f.name === "OEBPS/content.opf")!.text.match(/urn:uuid:[^<]+/)![0]).toBe(opf.match(/urn:uuid:[^<]+/)![0]);
  });
  test("TXT exports", () => {
    const t = novelToTxt(novel({ author: "도윤", episodes: [ep(0), ep(1)] }));
    expect(t).toMatch(/^비의 항구\n지은이: 도윤\n장르: 미스터리\n\n\n제1화 제목0\n\n본문 0\n\n\n제2화 제목1/);
    const r = roomToTxt({ id: "r", title: "이야기", premise: "", memory: "", characterIds: [], createdAt: 0, updatedAt: 0, messages: [{ id: "1", role: "user", text: "간다", createdAt: 0 }, { id: "2", role: "assistant", text: "", error: "x", createdAt: 0 }, { id: "3", role: "assistant", text: "장면", createdAt: 0 }] }, { user: "도윤" });
    expect(r).toBe("이야기\n\n▶ 도윤: 간다\n\n장면\n");
  });
});

test("E.No.S fullNovels import", () => {
  const r = parseLegacyBackup({ fullNovels: [{ title: "옛 소설", synopsis: "시놉", episodes: [{ episodeNumber: 2, title: "둘", summary: "s2", content: "본문2" }, { episodeNumber: 1, title: "하나", summary: "s1", content: "본문1" }, { episodeNumber: 3, title: "셋", summary: "s3" }] }] });
  const n = r.novels[0];
  expect(n).toMatchObject({ title: "옛 소설", brief: "시놉", episodeCount: 3 });
  expect(n.outline.map((o) => o.title)).toEqual(["하나", "둘", "셋"]);
  expect(n.episodes.map((e) => e.text)).toEqual(["본문1", "본문2"]);
});
