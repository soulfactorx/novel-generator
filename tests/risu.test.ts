import { describe, expect, test } from "vitest";
import { crc32 } from "../src/lib/exporters";
import { characterToCard, characterToCharx, fillMacros, greetingRoom, parseRisuFile, parseRisuJson, readRisum, worldToModule, writeRisum } from "../src/lib/risu";
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
    expect(w.description).toBe("주인공가 사는 도시");
    expect(w.lore.map((e) => [e.title, e.keys, !!e.always])).toEqual([["등불", ["등불", "마력등"], false], ["비", ["비"], true]]);
    expect(r.skipped).toEqual(["정규식 스크립트 1개", "트리거 2개"]);
  });

  test("V3 JSON 카드 → 등장인물 (로어·인사말·건너뛴 것)", () => {
    const r = parseRisuJson(cardV3)!;
    const c = r.library[0] as Character;
    expect(c).toMatchObject({ kind: "character", name: "서율", summary: "감찰관 · OC" });
    expect(c.profile).toBe("서율는 조합 감찰관이다. 주인공의 상관.\n\n성격: 냉정함\n\n기본 상황: 비 오는 항구");
    expect(c.speech).toBe('서율: "규정은 규정입니다."');
    expect(c.lore.map((e) => [e.title, e.content, e.enabled, !!e.always])).toEqual([["조합", "항구의 마법 조합", true, false], ["re", "정규식 로어", false, false], ["날씨", "항상 비가 온다", true, true]]);
    expect(r.greeting?.greetings).toEqual(["*서율가 서류를 내려놓는다.* 늦었군요, 주인공.", "서율: 또 만났네요."]);
    expect(r.skipped).toEqual(["시스템 프롬프트", "정규식 스크립트 2개", "트리거 1개"]);
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

  test("charx(DEFLATE) — module.risum 로어북 우선, JPEG 앞에 붙은 charx", async () => {
    const mod = writeRisum({ name: "서율 Module", lorebook: [{ key: "등불", content: "모듈 로어", comment: "등불", mode: "normal" }], regex: [{}] });
    const z = await deflateZip([
      { name: "card.json", data: enc(JSON.stringify(cardV3)) },
      { name: "module.risum", data: mod },
      { name: "assets/icon/image/main.png", data: new Uint8Array([1, 2, 3]) },
      { name: "assets/other/image/a.png", data: new Uint8Array([4]) },
    ]);
    expect(listZip(z).map((f) => f.method)).toEqual([8, 8, 8, 8]);
    const r = await parseRisuFile("서율.charx", z);
    const c = r.library[0] as Character;
    expect(r.source).toBe("캐릭터 카드(charx)");
    expect(c.lore.map((e) => e.content)).toEqual(["모듈 로어"]);
    expect(r.skipped).toContain("정규식 스크립트 3개"); // 카드 2개 + 모듈 1개
    expect(r.skipped).toContain("이미지·에셋 1개");
    const jpeg = concat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 0xff, 0xd9]), z);
    expect((await parseRisuFile("서율.jpeg", jpeg)).library[0].name).toBe("서율");
    const noCard = await deflateZip([{ name: "x.txt", data: enc("x") }]);
    await expect(parseRisuFile("a.charx", noCard)).rejects.toThrow("card.json");
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
    expect(back.lore.map((e) => [e.title, !!e.always])).toEqual([["레인포트 설명", true], ["레인포트 규칙", true], ["등불", false]]);
  });
});
