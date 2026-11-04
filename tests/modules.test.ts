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
