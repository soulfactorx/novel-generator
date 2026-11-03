// 봇 버튼 처리 중 표시 · AI를 부른 버튼 기억
import "fake-indexeddb/auto";
import { createRequire } from "node:module";
import { beforeEach, expect, test, vi } from "vitest";
import { zip } from "../src/lib/exporters";
import { parseRisuFile, writeRisum } from "../src/lib/risu";
import { claudeStream, mockFetch } from "./helpers";

beforeEach(async () => {
  const { IDBFactory } = await import("fake-indexeddb");
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  (await import("../src/lib/risuLua")).setLuaWasmUri(createRequire(import.meta.url).resolve("wasmoon/dist/glue.wasm"));
});

const LUA = `
onButtonClick = async(function(id, code)
  if code == "ask_3" then
    local r = LLM(id, { { role = "user", content = "추천" } })
    setChatVar(id, "ans", r.result)
  else
    setChatVar(id, "plain", "1")
  end
end)
`;

test("aiButtonKey: 숫자만 다른 같은 종류 버튼은 하나", async () => {
  const { aiButtonKey } = await import("../src/lib/store");
  expect(aiButtonKey("__btn:accept_9-2-day")).toBe("accept_#-#-day");
  expect(aiButtonKey("__form:rn_setup")).toBe("rn_setup");
});

test("버튼 처리 중 표시가 켜졌다 꺼지고, AI를 부른 버튼만 기억한다", async () => {
  const card = { spec: "chara_card_v3", data: { name: "봇", description: "", first_mes: "안녕", extensions: { risuai: { lowLevelAccess: true } } } };
  const mod = writeRisum({ name: "m", lorebook: [], trigger: [{ type: "start", comment: "", conditions: [], effect: [{ type: "triggerlua", code: LUA }] }] });
  const s = await import("../src/lib/store");
  await s.init();
  s.updateSettings({ provider: "anthropic", keys: { gemini: "", anthropic: "ak", openai: "" } });
  const data = await parseRisuFile("봇.charx", zip([{ name: "card.json", data: JSON.stringify(card) }, { name: "module.risum", data: mod }]));
  const { room } = await s.importRisu(data, { greeting: 0 });
  const r = () => s.getState().rooms[room!];
  const seen: (string | null)[] = [];
  const un = s.subscribe(() => seen.push(s.getState().botBusy ? `${s.getState().botBusy!.label}:${s.getState().botBusy!.ai}` : null));
  mockFetch(claudeStream("여성 추천"));
  await s.runRisuTrigger(room!, "__btn:ask_3", null, undefined, "추천 세팅");
  un();
  expect(r().vars?.ans).toBe("여성 추천");
  expect(seen).toContain("추천 세팅:1"); // AI를 기다리는 동안
  expect(s.getState().botBusy).toBeNull(); // 끝나면 꺼짐
  const bot = s.botKeyOf(r());
  expect(s.getState().aiButtons[bot]).toEqual(["ask_#"]);
  await s.runRisuTrigger(room!, "__btn:plain", null, undefined, "휴식");
  expect(r().vars?.plain).toBe("1");
  expect(s.getState().aiButtons[bot]).toEqual(["ask_#"]); // AI를 안 부른 버튼은 기억하지 않음
});
