import { describe, expect, test } from "vitest";
import { crc32 } from "../src/lib/exporters";
import { characterToCard, characterToCharx, fillMacros, greetingRoom, parseRisuFile, parseRisuJson, readRisum, rpackEncode, worldToModule, writeRisum } from "../src/lib/risu";
import type { Character, World } from "../src/lib/types";
import { listZip } from "../src/lib/unzip";

const enc = (s: string) => new TextEncoder().encode(s);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
};
async function deflateRaw(data: Uint8Array) {
  const s = new Response(data as BlobPart).body!.pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
/** fflate처럼 DEFLATE로 압축한 ZIP (테스트용) */
async function deflateZip(files: { name: string; data: Uint8Array }[]) {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let off = 0;
  for (const f of files) {
    const name = enc(f.name);
    const comp = await deflateRaw(f.data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x800, true); lh.setUint16(8, 8, true);
    lh.setUint32(14, crc32(f.data), true); lh.setUint32(18, comp.length, true); lh.setUint32(22, f.data.length, true); lh.setUint16(26, name.length, true);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x800, true); ch.setUint16(10, 8, true);
    ch.setUint32(16, crc32(f.data), true); ch.setUint32(20, comp.length, true); ch.setUint32(24, f.data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    const local = concat(new Uint8Array(lh.buffer), name, comp);
    locals.push(local);
    centrals.push(concat(new Uint8Array(ch.buffer), name));
    off += local.length;
  }
  const cd = concat(...centrals);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cd.length, true); end.setUint32(16, off, true);
  return concat(...locals, cd, new Uint8Array(end.buffer));
}
function pngWith(...texts: [string, object][]) {
  const text = (key: string, json: object) => concat(enc(key), new Uint8Array([0]), enc(btoa(String.fromCharCode(...enc(JSON.stringify(json))))));
  const chunk = (type: string, data: Uint8Array) => {
    const head = new DataView(new ArrayBuffer(4));
    head.setUint32(0, data.length);
    return concat(new Uint8Array(head.buffer), enc(type).subarray(0, 4), data, new Uint8Array(4));
  };
  return concat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", new Uint8Array(13)), ...texts.map(([k, j]) => chunk("tEXt", text(k, j))), chunk("IEND", new Uint8Array(0)));
}

// 가장 작은 PNG·WebP 머리 (형식 판별용)
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

const cardV3 = {
  spec: "chara_card_v3",
  spec_version: "3.0",
  data: {
    name: "서율",
    description: "{{char}}는 조합 감찰관이다. {{user}}의 상관.",
    personality: "냉정함",
    scenario: "비 오는 항구",
    first_mes: "*{{char}}가 서류를 내려놓는다.* 늦었군요, {{user}}.",
    alternate_greetings: ["<char>: 또 만났네요."],
    mes_example: "<START>\n{{char}}: \"규정은 규정입니다.\"",
    system_prompt: "{{original}}",
    tags: ["감찰관", "OC"],
    character_book: {
      entries: [
        { keys: ["조합", "길드"], content: "@@depth 0\n항구의 마법 조합", enabled: true, constant: false, comment: "조합" },
        { keys: ["/정규식.*/"], content: "정규식 로어", enabled: true, use_regex: true, comment: "re" },
        { keys: [], content: "항상 비가 온다", enabled: true, constant: true, comment: "날씨" },
        { keys: ["x"], content: "", enabled: true },
      ],
    },
    extensions: { risuai: { customScripts: [{}, {}], triggerscript: [{}] } },
  },
};

describe("RisuAI 가져오기", () => {
  test("매크로 치환", () => expect(fillMacros("{{char}}와 {{ USER }}, <user>", "서율")).toBe("서율와 주인공, 주인공"));

  test("risum 왕복 + 에셋 개수", () => {
    const b = writeRisum({ name: "레인포트 모듈", description: "설명", lorebook: [{ key: "등불, 마력등", content: "마력 등불", comment: "등불", mode: "normal", alwaysActive: false }] });
    expect(b[0]).toBe(111);
    expect(new TextDecoder().decode(b).includes("레인포트")).toBe(false); // RPack으로 가려져 있음
    expect(readRisum(b).module.name).toBe("레인포트 모듈");
    const withAsset = concat(b.subarray(0, b.length - 1), new Uint8Array([1, 2, 0, 0, 0, 7, 7, 0]));
    expect(readRisum(withAsset).assets).toBe(1);
    expect(() => readRisum(enc("{}"))).toThrow();
  });

  test(".risum 파일 → 세계관 + 로어북", async () => {
    const b = writeRisum({ name: "레인포트", description: "{{user}}가 사는 도시", lorebook: [{ key: "등불, 마력등", content: "마력 등불", comment: "등불", mode: "normal" }, { key: "", comment: "폴더", content: "", mode: "folder" }, { key: "비", content: "상시", alwaysActive: true }], regex: [{}], trigger: [{}, {}] });
    const r = await parseRisuFile("레인포트.risum", b);
    const w = r.library[0] as World;
    expect(w.kind).toBe("world");
    expect(w.description).toBe("### 비\n상시"); // 상시 로어는 설명으로 (모듈 설명은 화면 표시용)
    expect(w.lore.map((e) => [e.title, e.keys, !!e.always])).toEqual([["등불", ["등불", "마력등"], false]]);
    expect(r.skipped).toEqual(["트리거 스크립트 2개"]); // 내용 없는 정규식 스크립트는 버림
    expect(w.scripts).toBeUndefined();
  });

  test("V3 JSON 카드 → 등장인물 (로어·인사말·건너뛴 것)", () => {
    const r = parseRisuJson(cardV3)!;
    const c = r.library[0] as Character;
    expect(c).toMatchObject({ kind: "character", name: "서율", summary: "감찰관 · OC" });
    expect(c.profile).toBe("서율는 조합 감찰관이다. 주인공의 상관.\n\n성격: 냉정함\n\n기본 상황: 비 오는 항구\n\n### 날씨\n항상 비가 온다"); // 상시 로어는 프로필로
    expect(c.speech).toBe('서율: "규정은 규정입니다."');
    expect(c.lore.map((e) => [e.title, e.content, e.enabled, !!e.always])).toEqual([["조합", "항구의 마법 조합", true, false], ["re", "정규식 로어", false, false]]);
    expect(r.greeting?.greetings).toEqual(["*서율가 서류를 내려놓는다.* 늦었군요, 주인공.", "서율: 또 만났네요."]);
    expect(r.skipped).toEqual(["트리거 스크립트 1개"]); // system_prompt가 {{original}}뿐이면 바꾸는 것이 없음
    expect(r.images).toEqual([]);
    const room = greetingRoom(r.greeting!, 1);
    expect(room.characterIds).toEqual([c.id]);
    expect(room.messages[0]).toMatchObject({ role: "assistant", text: "서율: 또 만났네요." });
  });

  test("V1·V2 카드, PNG 카드(ccv3 우선)", async () => {
    expect(parseRisuJson({ name: "A", description: "d", first_mes: "hi" })?.library[0].name).toBe("A");
    expect(parseRisuJson({ spec: "chara_card_v2", data: { name: "B", description: "d" } })?.source).toBe("캐릭터 카드(V2)");
    const png = pngWith(["chara", { spec: "chara_card_v2", data: { name: "옛날" } }], ["ccv3", cardV3]);
    const r = await parseRisuFile("card.png", png);
    expect(r.source).toBe("캐릭터 카드(PNG)");
    expect(r.library[0].name).toBe("서율");
    await expect(parseRisuFile("x.png", pngWith(["other", {}]))).rejects.toThrow("캐릭터 카드 정보가 없습니다");
  });

  test("charx(DEFLATE) — 에셋·감정 이미지, 정규식 스크립트, module.risum 로어북 우선, JPEG 앞에 붙은 charx", async () => {
    const mod = writeRisum({ name: "서율 Module", lorebook: [{ key: "등불", content: "그림 목록: {{assetlist}}", comment: "등불", mode: "normal" }], regex: [{ comment: "그림", in: "<img=\"(.+?)\">", out: "{{img::$1}}", type: "editdisplay" }] });
    const card = { ...cardV3, data: { ...cardV3.data, extensions: { risuai: { viewScreen: "emotion", customScripts: [{ comment: "c", in: "a", out: "b", type: "editoutput" }] } }, assets: [
      { type: "icon", uri: "embeded://assets/icon/image/main.png", name: "main", ext: "png" },
      { type: "x-risu-asset", uri: "embeded://assets/other/image/항구.png", name: "항구", ext: "png" },
      { type: "emotion", uri: "embeded://assets/emotion/image/기쁨.webp", name: "기쁨", ext: "webp" },
      { type: "x-risu-asset", uri: "embeded://assets/other/audio/bgm.mp3", name: "bgm", ext: "mp3" },
      { type: "x-risu-asset", uri: "embeded://assets/other/image/없음.png", name: "없음", ext: "png" },
    ] } };
    const z = await deflateZip([
      { name: "card.json", data: enc(JSON.stringify(card)) },
      { name: "module.risum", data: mod },
      { name: "assets/icon/image/main.png", data: PNG },
      { name: "assets/other/image/항구.png", data: PNG },
      { name: "assets/emotion/image/기쁨.webp", data: WEBP },
      { name: "assets/other/audio/bgm.mp3", data: new Uint8Array([1]) },
    ]);
    expect(listZip(z).map((f) => f.method)).toEqual([8, 8, 8, 8, 8, 8]);
    const r = await parseRisuFile("서율.charx", z);
    const c = r.library[0] as Character;
    expect(r.source).toBe("캐릭터 카드(charx)");
    expect(c.lore.map((e) => e.content)).toEqual(['그림 목록: ["항구","없음"]']);
    expect(c.scripts?.map((x) => x.type)).toEqual(["editoutput", "editdisplay"]);
    expect(c.emotionMode).toBe(true);
    expect(r.images.map((x) => [x.name, x.kind, x.ownerId === c.id])).toEqual([["main", "icon", true], ["항구", "asset", true], ["기쁨", "emotion", true], ["없음", "asset", true]]);
    expect(await r.images[1].load()).toEqual(PNG);
    expect(await r.images[3].load()).toBeNull(); // charx 안에 없는 파일
    expect(r.skipped).toContain("그림이 아닌 에셋(음악·영상 등) 1개");
    const jpeg = concat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 0xff, 0xd9]), z);
    expect((await parseRisuFile("서율.jpeg", jpeg)).library[0].name).toBe("서율");
    const noCard = await deflateZip([{ name: "x.txt", data: enc("x") }]);
    await expect(parseRisuFile("a.charx", noCard)).rejects.toThrow("card.json");
  });

  test("risum 에셋 → 세계관 이미지, PNG 카드의 그림은 대표 이미지", async () => {
    const b = writeRisum({ name: "항구 모듈", assets: [["밤바다", "", "png"], ["노래", "", "mp3"]], lorebook: [] });
    const withAssets = concat(b.subarray(0, b.length - 1), new Uint8Array([1, PNG.length, 0, 0, 0]), rpackEncode(PNG), new Uint8Array([1, 1, 0, 0, 0, 5, 0]));
    const r = await parseRisuFile("항구.risum", withAssets);
    expect(r.images.map((x) => [x.name, x.kind])).toEqual([["밤바다", "asset"]]);
    expect(await r.images[0].load()).toEqual(PNG);
    const png = pngWith(["ccv3", { spec: "chara_card_v3", data: { name: "P", description: "d" } }]);
    const p = await parseRisuFile("p.png", png);
    expect(p.images.map((x) => [x.name, x.kind])).toEqual([["main", "icon"]]);
    expect(await p.images[0].load()).toEqual(png);
  });

  test("모듈 JSON · 로어북 JSON · World Info · 채팅", () => {
    expect(parseRisuJson({ type: "risuModule", name: "M", id: "1", lorebook: [{ key: "k", content: "c" }] })?.library[0]).toMatchObject({ kind: "world", name: "M" });
    expect((parseRisuJson({ type: "risu", ver: 1, data: [{ key: "k", content: "c", comment: "t" }] })?.library[0] as World).lore[0].title).toBe("t");
    const wi = parseRisuJson({ entries: { 0: { key: ["항구"], content: "비", comment: "항구", constant: false }, 1: { key: [], content: "꺼짐", disable: true } } })!;
    expect((wi.library[0] as World).lore.map((e) => [e.title, e.enabled])).toEqual([["항구", true], ["", false]]);
    const chat = parseRisuJson({ type: "risuChat", ver: 2, data: { name: "1번 대화", note: "메모", message: [{ role: "char", data: "안녕" }, { role: "user", data: "응" }, { role: "char", data: "주석", isComment: true }, { role: "char", data: " " }] } })!;
    expect(chat.rooms).toHaveLength(1);
    expect(chat.rooms[0]).toMatchObject({ title: "1번 대화", premise: "메모" });
    expect(chat.rooms[0].messages.map((m) => [m.role, m.text])).toEqual([["assistant", "안녕"], ["user", "응"]]);
    expect(chat.rooms[0].messages[1].createdAt).toBeGreaterThan(chat.rooms[0].messages[0].createdAt);
    expect(parseRisuJson({ type: "risuAllChats", ver: 2, data: [{ message: [{ role: "user", data: "a" }] }, { message: [{ role: "char", data: "b" }] }] })?.rooms).toHaveLength(2);
    expect(parseRisuJson({ app: "novel-generator", rooms: [] })).toBeNull();
    expect(parseRisuJson({ sessions: [] })).toBeNull();
  });
});

describe("RisuAI 내보내기", () => {
  const w: World = { kind: "world", id: "w", name: "레인포트", description: "비 오는 항구", rules: "마법엔 대가", lore: [{ id: "l1", title: "등불", keys: ["등불"], content: "마력 등불", enabled: true }], createdAt: 0, updatedAt: 0 };
  const c: Character = { kind: "character", id: "c", name: "서율", summary: "29세 · 감찰관", profile: "차갑다", speech: '"규정입니다."', lore: [{ id: "l2", title: "비밀", keys: ["비밀"], content: "사실은…", enabled: true }, { id: "l3", title: "꺼짐", keys: [], content: "x", enabled: false }], createdAt: 0, updatedAt: 0, worldId: "w" };

  test("JSON 카드(V3)", () => {
    const card = characterToCard(c, w);
    expect(card.spec).toBe("chara_card_v3");
    expect(card.data.description).toContain("[세계관: 레인포트]");
    expect(card.data.character_book.entries.map((e) => e.name)).toEqual(["비밀", "등불"]);
    // 다시 가져오면 같은 내용
    const back = parseRisuJson(JSON.parse(JSON.stringify(card)))!.library[0] as Character;
    expect(back.lore.map((e) => e.content)).toEqual(["사실은…", "마력 등불"]);
  });

  test("charx 왕복 (card.json + module.risum)", async () => {
    const z = characterToCharx(c);
    expect(listZip(z).map((f) => f.name)).toEqual(["module.risum", "card.json"]);
    const r = await parseRisuFile("서율.charx", z);
    const back = r.library[0] as Character;
    expect(back.name).toBe("서율");
    expect(back.speech).toBe('"규정입니다."');
    expect(back.lore.map((e) => [e.title, e.keys])).toEqual([["비밀", ["비밀"]]]);
  });

  test("세계관 → risum 모듈 (설명·규칙은 '항상' 로어)", async () => {
    const r = await parseRisuFile("레인포트.risum", writeRisum(worldToModule(w)));
    const back = r.library[0] as World;
    expect(back.name).toBe("레인포트");
    expect(back.description).toBe("### 레인포트 설명\n비 오는 항구");
    expect(back.rules).toBe("### 레인포트 규칙\n마법엔 대가"); // @@depth 0 → 규칙
    expect(back.lore.map((e) => [e.title, !!e.always])).toEqual([["등불", false]]);
  });
});

describe("RisuAI 봇: 설정이 상시 로어에, 그림 규칙이 post_history_instructions에 있는 경우", () => {
  test("상시 로어 → 프로필, @@depth 0 상시 로어 + post_history_instructions → 응답 직전 지시, 키워드 로어는 로어북", () => {
    const r = parseRisuJson({
      spec: "chara_card_v3",
      data: {
        name: "부르봉", description: "", first_mes: "", alternate_greetings: ["인사 1", ""],
        post_history_instructions: '<Image Commands>\n{{char}}의 표정을 <img src="A_B_C_D"> 로 출력\n</Image Commands>',
        system_prompt: "{{original}}",
        character_book: { entries: [
          { keys: [""], content: "부르봉 설정", constant: true, comment: "미호노 부르봉" },
          { keys: [""], content: "@@depth 0\n[체력:100% |…] 상태창을 맨 끝에", constant: true, comment: "상태창" },
          { keys: ["데뷔"], content: "데뷔 레이스 설명", constant: false, comment: "데뷔레이스" },
        ] },
      },
    })!;
    const c = r.library[0] as Character;
    expect(c.profile).toBe("### 미호노 부르봉\n부르봉 설정");
    expect(c.instructions).toBe('<Image Commands>\n부르봉의 표정을 <img src="A_B_C_D"> 로 출력\n</Image Commands>\n\n### 상태창\n[체력:100% |…] 상태창을 맨 끝에');
    expect(c.lore.map((l) => l.title)).toEqual(["데뷔레이스"]);
    expect(r.greeting?.greetings).toEqual(["인사 1"]);
    expect(r.skipped).toEqual([]); // {{original}}만 있는 system_prompt는 건너뛴 것이 아님
  });
});

describe("패키지 전체 내보내기 → 다시 가져오기", () => {
  test("charx: 이미지·인사말·응답 직전 지시·스크립트(켜진 것만)·감정 이미지 모드·한 줄 소개까지 그대로 돌아온다", async () => {
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7]);
    const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 9]);
    const meta = (id: string, name: string, kind: "icon" | "emotion" | "asset", mime: string) => ({ id, ownerId: "c", name, kind, mime, size: 1, createdAt: 0, updatedAt: 0 });
    const c: Character = {
      kind: "character", id: "c", name: "하루", summary: "등대지기", profile: "### 하루\n항구의 등대지기", speech: '"늦었네."', lore: [{ id: "l", title: "등대", keys: ["등대"], content: "오래된 등대", enabled: true }],
      instructions: '<img src="이름"> 으로 표정 출력', greetings: ["인사 A", "인사 B"], emotionMode: true,
      scripts: [{ comment: "그림", in: '<img src="(.*?)">', out: "{{img::$1}}", type: "editdisplay" }, { comment: "끈 것", in: "x", out: "y", type: "editoutput", disabled: true }],
      createdAt: 0, updatedAt: 0,
    };
    const z = characterToCharx(c, undefined, [
      { meta: meta("i1", "main", "icon", "image/png"), bytes: PNG },
      { meta: meta("i2", "harbor/night", "asset", "image/webp"), bytes: WEBP },
      { meta: meta("i3", "smile", "emotion", "image/png"), bytes: PNG },
    ]);
    expect(listZip(z).map((f) => f.name)).toEqual(["assets/icon/image/main.png", "assets/other/image/harbor_night.webp", "assets/emotion/image/smile.png", "module.risum", "card.json"]);
    const r = await parseRisuFile("하루.charx", z);
    const b = r.library[0] as Character;
    expect(b).toMatchObject({ name: "하루", summary: "등대지기", profile: "### 하루\n항구의 등대지기", speech: '"늦었네."', instructions: '<img src="이름"> 으로 표정 출력', greetings: ["인사 A", "인사 B"], emotionMode: true });
    expect(b.lore.map((l) => l.title)).toEqual(["등대"]);
    expect(b.scripts?.map((x) => x.comment)).toEqual(["그림"]);
    expect(r.images.map((x) => [x.name, x.kind])).toEqual([["main", "icon"], ["harbor/night", "asset"], ["smile", "emotion"]]);
    expect(await r.images[1].load()).toEqual(WEBP);
    expect(b.source).toMatchObject({ kind: "risu", file: "하루.charx", format: "캐릭터 카드(charx)" });
  });
});

test("제작자 노트 · 언어별 노트(CCv3 creator_notes_multilingual) 보관과 내보내기", async () => {
  const r = parseRisuJson({ spec: "chara_card_v3", data: { name: "N", description: "d", creator_notes: "기본 노트", creator_notes_multilingual: { ko: "한국어 노트", en: "English note", ja: "日本語ノート", fr: "" } } })!;
  const c = r.library[0] as Character;
  expect(c.notes).toBe("기본 노트");
  expect(c.notesByLang).toEqual({ ko: "한국어 노트", en: "English note", ja: "日本語ノート" });
  const back = (await parseRisuFile("n.charx", characterToCharx(c))).library[0] as Character;
  expect(back.notes).toBe("기본 노트");
  expect(back.notesByLang).toEqual(c.notesByLang);
});
