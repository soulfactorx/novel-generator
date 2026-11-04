// 모듈 붙이기: 등장인물·이야기에 RisuAI 모듈(세계관)을 여러 개 붙여 그림·로어북·스크립트·상시 설정을 함께 쓴다
import "fake-indexeddb/auto";
import { beforeEach, expect, test, vi } from "vitest";
import { parseRisuFile, rpackEncode, writeRisum } from "../src/lib/risu";
import { renderRisu } from "../src/lib/images";
import { buildSystemPrompt } from "../src/lib/prompt";
import type { Character, World } from "../src/lib/types";

beforeEach(async () => {
  const { IDBFactory } = await import("fake-indexeddb");
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
});
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

test("인물에 붙인 모듈의 그림·로어북·상시 설정·정규식이 이야기에 들어가고, 이야기에서 끄거나 따로 붙일 수 있다", async () => {
  const s = await import("../src/lib/store");
  await s.init();
  // 그림 1장 + 키워드 로어 + 상시 로어 + 정규식이 든 모듈
  const risum = writeRisum({ name: "옷장 모듈", assets: [["서율_교복", "", "png"]], lorebook: [{ key: "교복", content: "교복은 남색이다.", comment: "교복", mode: "normal" }, { key: "", content: "서율은 늘 리본을 단다.", comment: "상시", mode: "constant", alwaysActive: true }], regex: [{ comment: "옷", in: "\\[옷:(.+?)\\]", out: "{{img::$1}}", type: "editdisplay" }] });
  // 에셋 블록: [1, 길이(LE 4바이트), RPack 인코딩한 바이트] · 끝 0
  const enc = rpackEncode(PNG);
  const block = new Uint8Array(5 + enc.length);
  block[0] = 1;
  new DataView(block.buffer).setUint32(1, enc.length, true);
  block.set(enc, 5);
  const file = new Uint8Array(risum.length - 1 + block.length + 1);
  file.set(risum.subarray(0, risum.length - 1));
  file.set(block, risum.length - 1);
  const data = await parseRisuFile("옷장.risum", file);
  await s.importRisu(data);
  const mod = Object.values(s.getState().library).find((e) => e.kind === "world") as World;
  expect(Object.values(s.getState().images).filter((m) => m.ownerId === mod.id)).toHaveLength(1);

  const cid = s.createEntity("character");
  s.updateEntity<Character>(cid, { name: "서율", moduleIds: [mod.id] });
  const roomId = s.createRoom({ characterIds: [cid] });
  const room = () => s.getState().rooms[roomId];
  const ctx = s.contextFor(room());
  expect(ctx.modules?.map((m) => m.id)).toEqual([mod.id]);
  expect(ctx.world).toBeUndefined(); // 세계관 자리는 그대로
  // 그림 · 정규식
  const pool = s.poolFor(room());
  expect(renderRisu("[옷:서율_교복]", pool).html).toContain("nvimg:");
  // 상시 설정은 시스템 프롬프트에, 키워드 로어는 대화에 나오면
  const sys = buildSystemPrompt(s.getState().settings, room(), ctx);
  expect(sys).toContain("## 모듈: 옷장 모듈");
  expect(sys).toContain("서율은 늘 리본을 단다.");
  s.updateRoom(roomId, { messages: [{ id: "m1", role: "user", text: "교복을 입었다", createdAt: 1 }] });
  expect(s.loreFor(room(), s.contextFor(room())).map((h) => h.entry.content)).toEqual(["교복은 남색이다."]);

  // 이 이야기에서 끄기 → 빠짐, 이 이야기에만 붙이기 → 다시 들어감(중복 없이)
  s.updateRoom(roomId, { offModules: [mod.id] });
  expect(s.contextFor(room()).modules).toEqual([]);
  expect(renderRisu("[옷:서율_교복]", s.poolFor(room())).html).not.toContain("nvimg:");
  s.updateRoom(roomId, { offModules: [], moduleIds: [mod.id] });
  expect(s.contextFor(room()).modules?.map((m) => m.id)).toEqual([mod.id]);
  // 세계관으로도 쓰면 모듈로 두 번 넣지 않음
  s.updateRoom(roomId, { worldId: mod.id });
  expect(s.contextFor(room()).modules).toEqual([]);

  // 모듈을 지우면 인물·이야기의 연결도 정리
  s.updateRoom(roomId, { worldId: undefined });
  s.deleteEntity(mod.id);
  expect((s.getState().library[cid] as Character).moduleIds).toEqual([]);
  expect(room().moduleIds).toEqual([]);
});

test("charx 형태의 모듈: 캐릭터 설명·인사말은 버리고 그림·로어북(상시 포함)·정규식·응답 직전 지시만 모듈로", async () => {
  const { zip } = await import("../src/lib/exporters");
  const { cardAsModule } = await import("../src/lib/risu");
  const card = {
    spec: "chara_card_v3",
    data: {
      name: "의상 에셋팩", description: "에셋용 캐릭터입니다", first_mes: "이 카드는 모듈입니다", post_history_instructions: "장면마다 <img=\"이름\">을 쓴다.",
      character_book: { entries: [{ keys: [], content: "의상 규칙: 계절에 맞춘다.", constant: true, enabled: true, comment: "규칙" }, { keys: ["코트"], content: "코트는 회색.", enabled: true, comment: "코트" }] },
      extensions: { risuai: { customScripts: [{ comment: "그림", in: "\\[옷:(.+?)\\]", out: "{{img::$1}}", type: "editdisplay" }] } },
      assets: [{ type: "x-risu-asset", uri: "embeded://assets/other/image/코트.png", name: "코트", ext: "png" }],
    },
  };
  const parsed = await parseRisuFile("에셋팩.charx", zip([{ name: "card.json", data: JSON.stringify(card) }, { name: "assets/other/image/코트.png", data: PNG }]));
  const m = cardAsModule(parsed)!;
  const w = m.library[0] as World;
  expect(w.kind).toBe("world");
  expect(w.name).toBe("의상 에셋팩");
  expect(w.description).toBe(""); // 껍데기 캐릭터 설명은 버림
  expect(w.rules).toBe('장면마다 <img="이름">을 쓴다.');
  expect(w.lore.map((l) => [l.content, !!l.always])).toEqual([["의상 규칙: 계절에 맞춘다.", true], ["코트는 회색.", false]]);
  expect(w.scripts?.length).toBe(1);
  expect(m.greeting).toBeUndefined();
  expect(m.images.map((x) => [x.name, x.ownerId === w.id])).toEqual([["코트", true]]);
  expect(await m.images[0].load()).toEqual(PNG);
  // 붙이면 다른 인물의 이야기에서 그림·상시 규칙이 함께 쓰인다
  const s = await import("../src/lib/store");
  await s.init();
  await s.importRisu(m);
  const cid = s.createEntity("character");
  s.updateEntity<Character>(cid, { name: "서율", moduleIds: [w.id] });
  const rid = s.createRoom({ characterIds: [cid] });
  const room = s.getState().rooms[rid];
  expect(renderRisu("[옷:코트]", s.poolFor(room)).html).toContain("nvimg:");
  expect(buildSystemPrompt(s.getState().settings, room, s.contextFor(room))).toContain('## 모듈: 의상 에셋팩\n장면마다 <img="이름">을 쓴다.');
  expect(cardAsModule(await parseRisuFile("모듈.risum", writeRisum({ name: "x", lorebook: [] })))).toBeNull(); // 카드가 아니면 null
});
