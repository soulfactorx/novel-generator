// 시작 화면을 Lua로 그리는 봇 (예: 치매검후 DMT) — 가져오기 → 시작 화면 → [시작] 버튼 → 인사말
import "fake-indexeddb/auto";
import { createRequire } from "node:module";
import { beforeEach, expect, test, vi } from "vitest";
import { zip } from "../src/lib/exporters";
import { parseRisuFile, writeRisum } from "../src/lib/risu";
import { renderRisu } from "../src/lib/images";

beforeEach(async () => {
  const { IDBFactory } = await import("fake-indexeddb");
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  (await import("../src/lib/risuLua")).setLuaWasmUri(createRequire(import.meta.url).resolve("wasmoon/dist/glue.wasm"));
});

const LUA = `
local function text(id, key)
  local rows = getLoreBooks(id, "TEXT")
  for _, r in ipairs(rows or {}) do
    local v = r.content:match(key .. ": ([^\\n]+)")
    if v then return v end
  end
  error("Missing TEXT " .. key)
end
listenEdit("editDisplay", function(id, data)
  if getChatVar(id, "setup") == "ready" then return (data:gsub("▥START▥", "")) end
  return (data:gsub("▥START▥", '<button risu-btn="begin">' .. text(id, "START") .. '</button>'))
end)
function onButtonClick(id, code)
  if code == "begin" then setChatVar(id, "setup", "ready") end
end
`;

test("Lua 시작 화면: 키 없는 로어(데이터)·Lua가 정규식보다 먼저·인사말의 {{role}}은 char", async () => {
  const card = {
    spec: "chara_card_v3",
    data: {
      name: "검후",
      description: "",
      first_mes: "▥START▥\n{{#when::{{equal::{{getvar::setup}}::ready}}}}별채의 하루[{{role}}]{{/when}}",
      extensions: { risuai: { defaultVariables: "setup=setup" } },
    },
  };
  const mod = writeRisum({
    name: "m",
    lorebook: [{ key: "", comment: "TEXT", content: "ID: ui_text\nSTART: 시작하기", mode: "normal", alwaysActive: false }],
    regex: [{ comment: "대체", in: "▥START▥", out: "시작 화면을 불러오지 못했어요", type: "editdisplay" }],
    trigger: [{ type: "start", comment: "", conditions: [], effect: [{ type: "triggerlua", code: LUA }] }],
  });
  const s = await import("../src/lib/store");
  await s.init();
  const data = await parseRisuFile("검후.charx", zip([{ name: "card.json", data: JSON.stringify(card) }, { name: "module.risum", data: mod }]));
  const c = data.library[0] as { lore: { title: string; keys: string[]; always?: boolean }[]; profile: string };
  expect(c.lore.find((l) => l.title === "TEXT")).toMatchObject({ keys: [] }); // 상시 로어로 바뀌어 본문으로 옮겨지지 않음
  expect(c.lore.find((l) => l.title === "TEXT")?.always).toBeUndefined();
  const { room } = await s.importRisu(data, { greeting: 0 });
  const r = () => s.getState().rooms[room!];
  const show = async () => {
    const m = r().messages[0];
    const lua = s.displayLua(r(), m.id)!;
    return renderRisu(await lua(m.text), s.poolFor(r()), s.displayCbs(r(), m.id)).html;
  };
  const before = await show();
  expect(before).toContain('<button risu-btn="begin">시작하기</button>');
  expect(before).not.toContain("불러오지 못했어요");
  expect(before).not.toContain("별채");
  await s.runRisuTrigger(room!, "__btn:begin", null);
  expect(r().vars?.setup).toBe("ready");
  expect((await show()).trim()).toBe("별채의 하루[char]");
});
