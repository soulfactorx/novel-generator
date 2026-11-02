import { createRequire } from "node:module";
import { beforeAll, describe, expect, test } from "vitest";
import { luaCodesOf, runLua, setLuaWasmUri, type LuaHost } from "../src/lib/risuLua";

beforeAll(() => {
  setLuaWasmUri(createRequire(import.meta.url).resolve("wasmoon/dist/glue.wasm"));
});

type TestHost = LuaHost & { vars: Record<string, string>; alerts: string[]; reloads: number };
function host(over: Partial<LuaHost> = {}): TestHost {
  const vars: Record<string, string> = {};
  const h: TestHost = {
    vars,
    alerts: [] as string[],
    reloads: 0,
    chat: [{ role: "user", data: "안녕" }, { role: "char", data: "반가워 [IY: 1 | 2]" }] as LuaHost["chat"],
    getVar: (k: string) => vars[k] ?? "null",
    setVar: (k: string, v: string) => {
      const c = vars[k] !== v;
      vars[k] = v;
      return c;
    },
    getGlobal: (k: string) => (k === "toggle_lang" ? "1" : "null"),
    cbs: (t: string) => t.replace("{{user}}", "도윤"),
    alertNormal: (m: string) => void h.alerts.push(m),
    alertError: (m: string) => void h.alerts.push("E:" + m),
    alertInput: async (m: string): Promise<string | null> => (h.alerts.push("?" + m), "입력값"),
    alertSelect: async () => "1",
    alertConfirm: async () => true,
    reload: () => void h.reloads++,
    ...over,
  };
  return h;
}

const CODE = `
local function setBoth(id, k, v) setState(id, k, v); setChatVar(id, k, tostring(v)) end
function setPermaKarenya(id) setBoth(id, "perma", "fm_karenya"); reloadDisplay(id) end
function readBack(id)
  local st = getState(id, "perma")
  setChatVar(id, "echo", st .. "/" .. getGlobalVar(id, "toggle_lang") .. "/" .. cbs("{{user}}"))
end
onOutput = async(function(id)
  local chats = getFullChat(id)
  setChat(id, #chats - 1, chats[#chats].data .. " (수정됨)")
  addChat(id, "user", "추가")
  alertNormal(id, "끝")
end)
askName = async(function(id)
  local a = alertInput(id, "이름?"):await()
  setChatVar(id, "name", a)
end)
function onButtonClick(id, data) setChatVar(id, "clicked", data) end
listenEdit("editDisplay", function(id, value, meta)
  if not value:find("[IY:", 1, true) then return value end
  return (value:gsub("%[IY:[^%]]*%]", "<div class='card'>상태 " .. tostring(meta.index) .. "</div>"))
end)
listenEdit("editRequest", function(id, value, meta)
  table.insert(value, 1, { role = "system", content = "세계 메모" })
  return value
end)
`;

describe("Lua (RisuAI 방식)", () => {
  test("버튼 함수: setState·setChatVar·reloadDisplay, 다시 읽기(getState·getGlobalVar·cbs)", async () => {
    const h = host();
    await runLua(CODE, "setPermaKarenya", h);
    expect(h.vars.perma).toBe("fm_karenya");
    expect(h.vars.__perma).toBe('"fm_karenya"'); // setState는 JSON으로 저장
    expect(h.reloads).toBe(1);
    await runLua(CODE, "readBack", h);
    expect(h.vars.echo).toBe("fm_karenya/1/도윤");
  });
  test("onOutput(async): getFullChat · setChat · addChat · alertNormal", async () => {
    const h = host();
    const r = await runLua(CODE, "output", h);
    expect(r.error).toBeUndefined();
    expect(h.chat.map((m) => [m.role, m.data])).toEqual([["user", "안녕"], ["char", "반가워 [IY: 1 | 2] (수정됨)"], ["user", "추가"]]);
    expect(h.alerts).toEqual(["끝"]);
  });
  test("alertInput:await() 와 onButtonClick(값)", async () => {
    const h = host();
    await runLua(CODE, "askName", h);
    expect(h.vars.name).toBe("입력값");
    await runLua(CODE, "onButtonClick", h, "btn-1");
    expect(h.vars.clicked).toBe("btn-1");
  });
  test("listenEdit: editDisplay(문자열, meta.index) · editRequest(메시지 배열)", async () => {
    const h = host();
    const d = await runLua(CODE, "editDisplay", h, "본문\n[IY: 429 | 15:00]", { index: 3 });
    expect(d.res).toBe("본문\n<div class='card'>상태 3</div>");
    const r = await runLua(CODE, "editRequest", h, [{ role: "user", content: "안녕" }]);
    expect(r.res).toEqual([{ role: "system", content: "세계 메모" }, { role: "user", content: "안녕" }]);
    const none = await runLua("x = 1", "editDisplay", h, "그대로");
    expect(none.res).toBe("그대로");
  });
  test("표시용 실행에서는 채팅을 바꾸지 못한다 (RisuAI 권한 규칙)", async () => {
    const h = host();
    await runLua(`listenEdit("editDisplay", function(id, v) addChat(id, "user", "몰래"); setChatVar(id, "seen", "1"); return v end)`, "editDisplay", h, "x");
    expect(h.chat).toHaveLength(2);
    expect(h.vars.seen).toBe("1");
  });
  test("오류가 나도 앱은 멈추지 않고 값을 돌려준다", async () => {
    const h = host();
    const r = await runLua(`listenEdit("editDisplay", function(id, v) error("boom") end)`, "editDisplay", h, "원문");
    expect(r.res).toBe("원문");
    const r2 = await runLua(`function bad(id) error("나쁨") end`, "bad", h);
    expect(r2.error).toContain("나쁨");
  });
  test("트리거 목록에서 Lua 코드 찾기", () => {
    expect(luaCodesOf([{ effect: [{ type: "triggerlua", code: "a=1" }] }, { effect: [{ type: "setvar" }] }])).toEqual(["a=1"]);
  });
});
