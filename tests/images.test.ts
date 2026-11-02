import { describe, expect, test } from "vitest";
import { novelToEpub, novelToTxt } from "../src/lib/exporters";
import { editDistance, findAsset, hasOwnImageRules, htmlToBlocks, imagePool, imagePromptSection, renderRisu, runScripts, scopeCss } from "../src/lib/images";
import { buildEpisodeRequest } from "../src/lib/novel";
import { buildSystemPrompt, instructionsOf } from "../src/lib/prompt";
import { listZip } from "../src/lib/unzip";
import { DEFAULT_SETTINGS, normalizeNovel, type Character, type ImageMeta, type RegexScript, type Room } from "../src/lib/types";

const img = (id: string, name: string, kind: ImageMeta["kind"] = "asset", ownerId = "c"): ImageMeta => ({ id, ownerId, name, kind, mime: "image/png", size: 1, createdAt: Number(id.replace(/\D/g, "")) || 0, updatedAt: 0 });
const char = (o: Partial<Character> = {}): Character => ({ kind: "character", id: "c", name: "서율", summary: "", profile: "", speech: "", lore: [], createdAt: 0, updatedAt: 0, ...o });
const sc = (o: Partial<RegexScript>): RegexScript => ({ comment: "", in: "", out: "", type: "editdisplay", ...o });

describe("정규식 스크립트 (RisuAI 동작)", () => {
  test("모드별 적용, 캡처 그룹, $n, 잘못된 정규식 무시", () => {
    const scripts = [sc({ in: "<img=\"(.+?)\">", out: "{{img::$1}}" }), sc({ in: "a", out: "b", type: "editoutput" }), sc({ in: "(", out: "x" }), sc({ in: "줄", out: "한$n줄" })];
    expect(runScripts('그림 <img="항구"> a 줄', scripts, "editdisplay").text).toBe("그림 {{img::항구}} a 한\n줄");
    expect(runScripts("aaa", scripts, "editoutput").text).toBe("bbb");
  });
  test("ableFlag·order·@@emo·move_top·출력이 >로 끝나면 줄바꿈", () => {
    const scripts = [
      sc({ in: "x", out: "1", ableFlag: true, flag: "<order 1>" }),
      sc({ in: "X", out: "2", ableFlag: true, flag: "i<order 5>" }),
      sc({ in: "\\[웃음\\]", out: "@@emo 기쁨" }),
      sc({ in: "\\[상태:(.+?)\\]", out: "@@move_top <b>$1</b>" }),
      sc({ in: "끝", out: "<hr>" }),
    ];
    const r = runScripts("x [웃음] 본문 [상태:좋음] 끝", scripts, "editdisplay");
    expect(r.emotion).toBe("기쁨");
    expect(r.text.startsWith("<b>좋음</b>\n")).toBe(true); // 위로 옮김
    expect(r.text).toContain("2 [웃음]"); // order 5가 먼저(대소문자 무시) → x가 2로
    expect(r.text).toContain("<hr>\n");
  });
});

describe("에셋 이름 · 그림 표시", () => {
  const list = [img("i1", "Harbor_Night"), img("i2", "smile", "emotion"), img("i3", "main", "icon")];
  test("정확히 → 대소문자 무시 → 비슷한 이름(거리 4 이하)", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(findAsset("harbor_night", list)?.id).toBe("i1");
    expect(findAsset("harbor night.png", list)?.id).toBe("i1");
    expect(findAsset("완전히다른이름입니다", list)).toBeUndefined();
  });
  test("renderRisu: editdisplay → <Emotion> → {{img}}/{{raw}} → 토큰", () => {
    const pool = imagePool({ characters: [char({ scripts: [sc({ in: "<img=\"(.+?)\">", out: "{{img::$1}}" })] })] }, list);
    const r = renderRisu('밤이다. <img="harbor_night">\n<Emotion="smile">\n<div style="background:url({{raw::main}})">x</div>{{img::없는그림}}', pool);
    expect(r.ids.sort()).toEqual(["i1", "i2", "i3"]);
    expect(r.html).toContain('<img src="nvimg:i1"');
    expect(r.html).toContain('<img src="nvimg:i2"');
    expect(r.html).toContain("url(nvimg:i3)");
    expect(r.html).not.toContain("없는그림");
  });
  test("htmlToBlocks: 문단과 그림을 나눔, 태그·엔티티 정리", () => {
    expect(htmlToBlocks('첫 문단\n\n<img src="nvimg:i1" class="x">\n<b>둘째</b> &amp; 셋<br>넷<div>다섯</div>')).toEqual([
      { type: "text", text: "첫 문단" },
      { type: "image", id: "i1" },
      { type: "text", text: "둘째 & 셋\n넷\n다섯" },
    ]);
  });
});

describe("프롬프트", () => {
  const room: Room = { id: "r", title: "t", premise: "", memory: "", messages: [], createdAt: 0, updatedAt: 0, characterIds: ["c"] };
  test("봇이 그림 규칙을 정해 두었으면 그 규칙을 따르라고만 한다", () => {
    const c = char({ profile: '장면마다 <img="장소이름">을 출력한다.' });
    const pool = imagePool({ characters: [c] }, [img("i1", "항구")]);
    expect(hasOwnImageRules({ characters: [c] }, pool)).toBe(true);
    const lines = imagePromptSection({ characters: [c] }, pool, "chat");
    expect(lines.join("\n")).toContain("설정에 정해진 그림 표시 규칙");
    expect(lines.join("\n")).not.toContain("그림 목록");
  });
  test("규칙이 없으면 에셋 이름 목록과 {{img::이름}} 사용법을 알려 준다 (대표 이미지는 제외)", () => {
    const c = char();
    const pool = imagePool({ characters: [c] }, [img("i1", "항구"), img("i2", "main", "icon")]);
    const sys = buildSystemPrompt(DEFAULT_SETTINGS, room, { characters: [c] }, imagePromptSection({ characters: [c] }, pool, "chat"));
    expect(sys).toContain("그림 목록: 항구");
    expect(sys).toContain("{{img::이름}}");
    expect(sys).not.toContain("main");
  });
  test("감정 이미지 모드: 응답 끝에 <Emotion=\"이름\">", () => {
    const c = char({ emotionMode: true });
    const pool = imagePool({ characters: [c] }, [img("i1", "기쁨", "emotion"), img("i2", "슬픔", "emotion")]);
    const text = imagePromptSection({ characters: [c] }, pool, "chat").join("\n");
    expect(text).toContain('<Emotion="이름">');
    expect(text).toContain("기쁨, 슬픔");
  });
  test("소설 회차 요청에도 그림 규칙이 들어간다", () => {
    const c = char();
    const n = normalizeNovel({ id: "n", title: "T", author: "", genre: "", brief: "b", characterIds: ["c"], episodeCount: 2, episodeLength: "short", outline: [{ id: "o", title: "1화", summary: "s" }], episodes: [], createdAt: 0, updatedAt: 0 });
    const pool = imagePool({ characters: [c] }, [img("i1", "항구")]);
    const req = buildEpisodeRequest(DEFAULT_SETTINGS, n, { characters: [c] }, 0, { imageRules: imagePromptSection({ characters: [c] }, pool, "novel") });
    expect(req.system).toContain("한 회차에 3개 이하");
  });
});

describe("내보내기", () => {
  test("EPUB에 원고 속 그림이 들어가고, TXT에서는 빠진다", () => {
    const n = normalizeNovel({ id: "n", title: "T", author: "", genre: "", brief: "", characterIds: [], episodeCount: 1, episodeLength: "short", outline: [], episodes: [{ id: "e", title: "1화", text: "앞\n\n{{img::항구}}\n\n뒤", summary: "", createdAt: 0, updatedAt: 0 }], createdAt: 0, updatedAt: 0 });
    const pool = imagePool({ characters: [char()] }, [img("i1", "항구")]);
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]);
    const ex = { blocks: (t: string) => htmlToBlocks(renderRisu(t, pool).html), images: { i1: { bytes: PNG, mime: "image/png" } } };
    const epub = novelToEpub(n, new Date(0), ex);
    const names = listZip(epub).map((f) => f.name);
    expect(names).toContain("OEBPS/images/i1.png");
    const ch = new TextDecoder().decode(epub);
    expect(ch).toContain('<div class="ill"><img src="images/i1.png" alt=""/></div>');
    expect(ch).toContain('media-type="image/png"');
    expect(novelToTxt(n, ex)).toContain("앞\n\n뒤");
  });
});

describe("실제 RisuAI 봇 구조 (부르봉과 라이스샤워 charx 분석 기반)", () => {
  // 이름 형식: 인물_구분_복장_표정
  const names = ["bourbon_sfw_school_standing", "bourbon_sfw_school_smile", "bourbon_sfw_school_admiring", "bourbon_sfw_school_happy smile", "bourbon_sfw_school_sad", "bourbon_sfw_gym_smile", "rice_sfw_casual_looking away shyly", "rice_sfw_race_proud1"];
  const list = names.map((n, i) => img(`i${i}`, n));
  const name = (q: string) => list.find((m) => m.id === findAsset(q, list)?.id)?.name ?? null;
  test("이름 찾기: 밑줄↔공백, 앞부분 일치, 표정만 비슷, 없는 복장은 같은 인물의 다른 복장, 다른 감정은 고르지 않음", () => {
    expect(name("rice_sfw_casual_looking_away_shyly")).toBe("rice_sfw_casual_looking away shyly");
    expect(name("bourbon_sfw_school_happy")).toBe("bourbon_sfw_school_happy smile");
    expect(name("bourbon_sfw_school_smiling")).toBe("bourbon_sfw_school_smile"); // admiring 아님
    expect(name("bourbon_sfw_swimsuit_smile")).toMatch(/^bourbon_sfw_(school|gym)_smile$/); // 수영복 그림이 없으면 같은 인물의 smile
    expect(name("Rice_SFW_Race_Proud")).toBe("rice_sfw_race_proud1");
    expect(name("bourbon_sfw_school_melancholic")).toBeNull(); // sad로 바꾸지 않음
  });
  test('<img src="에셋이름"> 은 봇 스크립트 없이도 그림으로, 주소(https·data)는 그대로', () => {
    const pool = imagePool({ characters: [char()] }, list);
    const r = renderRisu('앞\n\n<img src="bourbon_sfw_school_standing">\n\n<img="rice_sfw_race_proud1">\n<img src="https://x/y.png"> <img src="없는그림">', pool);
    expect(r.ids.sort()).toEqual(["i0", "i7"]);
    expect(r.html).toContain('<img src="nvimg:i0">');
    expect(r.html).toContain('src="nvimg:i7"');
    expect(r.html).toContain('src="https://x/y.png"'); // 안전 처리 단계에서 지워짐
  });
  test("봇 스크립트가 <img src> 를 {{raw::}} 로 감싸는 경우 (charx module.risum의 '에셋' 스크립트)", () => {
    const c = char({ updatedAt: 5, scripts: [sc({ in: '<img src="(.*?)">', out: '<style>.container{display:grid}</style><div class="container"><img class="roundedImage" src="{{raw::$1}}"></div>' })] });
    const r = renderRisu('<img src="bourbon_sfw_gym_smile">', imagePool({ characters: [c] }, list));
    expect(r.ids).toEqual(["i5"]);
    expect(r.html).toContain('<img class="roundedImage" src="nvimg:i5">');
  });
  test("상태창 <style>: 이 메시지 범위로 한정, body·@import·외부 url·fixed 제거, @media 유지", () => {
    const css = `@import url('https://fonts.googleapis.com/x'); body { min-height:100vh; background:#707090 } .status-window, .bar:hover { background-color:#13a9b0; position: fixed; color: red } @media (max-width:600px){ .stat-item{ padding:2px } } @font-face{font-family:x;src:url(https://x)} .bg{background:url(https://evil/x.png)} @keyframes k{from{opacity:0}to{opacity:1}}`;
    const out = scopeCss(css, "rs1");
    expect(out).not.toContain("@import");
    expect(out).not.toMatch(/rs1 body|min-height/);
    expect(out).toContain(".rs1 .status-window,.rs1 .bar:hover{");
    expect(out).toContain("background-color:#13a9b0");
    expect(out).not.toContain("fixed");
    expect(out).toContain("@media (max-width:600px){.rs1 .stat-item{");
    expect(out).not.toContain("font-face");
    expect(out).not.toContain("evil");
    expect(out).toContain("@keyframes k{");
  });
  test("응답 직전 지시는 대화·소설 모두에 전달", () => {
    const c = char({ instructions: '<Image Commands>\n<img src="A_B_C_D"> 형식으로 출력\n</Image Commands>' });
    expect(instructionsOf({ characters: [c] })).toContain("<Image Commands>");
    expect(instructionsOf({ characters: [c, char({ id: "d", name: "라이스", instructions: "상태창 출력" })] })).toContain("[라이스]\n상태창 출력");
    const n = normalizeNovel({ id: "n", title: "T", author: "", genre: "", brief: "b", characterIds: ["c"], episodeCount: 1, episodeLength: "short", outline: [{ id: "o", title: "1화", summary: "s" }], episodes: [], createdAt: 0, updatedAt: 0 });
    const req = buildEpisodeRequest(DEFAULT_SETTINGS, n, { characters: [c] }, 0, { instructions: instructionsOf({ characters: [c] }) });
    expect(String(req.messages[0].content)).toContain("## 설정에 정해진 지시 (반드시 따를 것)\n<Image Commands>");
    // 봇 규칙이 지시에 있으면 '봇 규칙을 따르라'로 안내
    expect(hasOwnImageRules({ characters: [c] }, imagePool({ characters: [c] }, list))).toBe(true);
  });
});

test("CSS: 주소 안의 ; { } 와 따옴표 때문에 규칙이 깨지지 않는다 (실제 봇의 @import 구글 폰트)", () => {
  const css = "@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap');\nbody { margin: 0 }\n.status-window { background-color: #13a9b0; content: \"a;b}c\" }\n.x{color:red}";
  const out = scopeCss(css, "rs1");
  expect(out).toBe('.rs1 .status-window{ background-color: #13a9b0; content: "a;b}c" }.rs1 .x{color:red}');
});

test("꺼 둔 스크립트는 적용하지 않는다", () => {
  expect(runScripts("a", [sc({ in: "a", out: "b", type: "editoutput", disabled: true }), sc({ in: "a", out: "c", type: "editoutput" })], "editoutput").text).toBe("c");
});
