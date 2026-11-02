import { describe, expect, test } from "vitest";
import { runTriggers, type RisuTrigger, type TriggerChat, type TriggerHost } from "../src/lib/risuTriggers";

function makeHost(o: { vars?: Record<string, string>; globals?: Record<string, string>; chat?: TriggerChat[]; inputs?: (string | null)[] } = {}) {
  const vars: Record<string, string> = { ...(o.vars ?? {}) };
  const globals = o.globals ?? {};
  const alerts: string[] = [];
  const inputs = [...(o.inputs ?? [])];
  const host: TriggerHost = {
    chat: o.chat ?? [],
    getVar: (k) => vars[k] ?? "null",
    setVar: (k, v) => { vars[k] = v; },
    getGlobal: (k) => globals[k] ?? "null",
    // tiny CBS stand-in: {{getvar::x}}
    cbs: (t) => t.replace(/\{\{getvar::([^}]+)\}\}/g, (_, k: string) => vars[k] ?? "null"),
    alertNormal: (m) => { alerts.push("normal:" + m); },
    alertError: (m) => { alerts.push("error:" + m); },
    alertInput: async (m) => { alerts.push("input:" + m); return inputs.shift() ?? null; },
    alertSelect: async (opts) => { alerts.push("select:" + opts.join(",")); return inputs.shift() ?? null; },
    firstMessage: "Hello there",
    description: "desc",
    log: () => {},
  };
  return { host, vars, alerts };
}

const trig = (type: string, effect: any[], conditions: any[] = [], extra: Partial<RisuTrigger> = {}): RisuTrigger =>
  ({ comment: "", type, conditions, effect, ...extra });

const setv = (v: string, value: string, operator = "=") => ({ type: "setvar", var: v, value, operator });

describe("conditions", () => {
  const cases: [string, string, string, boolean][] = [
    ["=", "5", "5", true], ["=", "5", "6", false],
    ["!=", "5", "6", true], ["!=", "5", "5", false],
    [">", "6", "5", true], [">", "5", "5", false],
    ["<", "4", "5", true], ["<", "5", "5", false],
    [">=", "5", "5", true], [">=", "4", "5", false],
    ["<=", "5", "5", true], ["<=", "6", "5", false],
    ["true", "true", "", true], ["true", "1", "", true], ["true", "yes", "", false],
    ["null", "null", "", true], ["null", "0", "", false],
  ];
  for (const [op, a, b, expected] of cases) {
    test(`var ${a} ${op} ${b} -> ${expected}`, async () => {
      const { host, vars } = makeHost({ vars: { x: a } });
      await runTriggers([trig("start", [setv("hit", "1")], [{ type: "var", var: "x", value: b, operator: op }])], "start", host);
      expect(vars.hit === "1").toBe(expected);
    });
  }

  test("missing var reads as 'null'", async () => {
    const { host, vars } = makeHost();
    await runTriggers([trig("start", [setv("hit", "1")], [{ type: "var", var: "nope", value: "", operator: "null" }])], "start", host);
    expect(vars.hit).toBe("1");
  });

  test("value and chatindex conditions; cbs applied to condition value", async () => {
    const { host, vars } = makeHost({ vars: { n: "2" }, chat: [{ role: "user", data: "a" }, { role: "char", data: "b" }] });
    await runTriggers([
      trig("start", [setv("a", "1")], [{ type: "value", var: "abc", value: "abc", operator: "=" }]),
      trig("start", [setv("b", "1")], [{ type: "chatindex", value: "{{getvar::n}}", operator: "=" }]),
      trig("start", [setv("c", "1")], [{ type: "chatindex", value: "3", operator: ">=" }]),
    ], "start", host);
    expect(vars).toMatchObject({ a: "1", b: "1" });
    expect(vars.c).toBeUndefined();
  });

  test("exists strict / loose / regex with depth", async () => {
    const chat: TriggerChat[] = [{ role: "user", data: "old Dragon" }, { role: "char", data: "the Sword shines" }];
    const { host, vars } = makeHost({ chat });
    await runTriggers([
      trig("start", [setv("strict", "1")], [{ type: "exists", value: "Sword", type2: "strict", depth: 1 }]),
      trig("start", [setv("strictMiss", "1")], [{ type: "exists", value: "Swo", type2: "strict", depth: 1 }]),
      trig("start", [setv("loose", "1")], [{ type: "exists", value: "sWo", type2: "loose", depth: 1 }]),
      trig("start", [setv("depthMiss", "1")], [{ type: "exists", value: "dragon", type2: "loose", depth: 1 }]),
      trig("start", [setv("depthAll", "1")], [{ type: "exists", value: "dragon", type2: "loose", depth: 0 }]),
      trig("start", [setv("regex", "1")], [{ type: "exists", value: "S\\w+d", type2: "regex", depth: 2 }]),
    ], "start", host);
    expect(vars).toEqual({ strict: "1", loose: "1", depthAll: "1", regex: "1" });
  });

  test("all conditions must pass", async () => {
    const { host, vars } = makeHost({ vars: { a: "1", b: "2" } });
    await runTriggers([trig("start", [setv("hit", "1")], [
      { type: "var", var: "a", value: "1", operator: "=" },
      { type: "var", var: "b", value: "1", operator: "=" },
    ])], "start", host);
    expect(vars.hit).toBeUndefined();
  });
});

describe("selection", () => {
  test("mode filters by trigger.type; manualName matches comment regardless of mode", async () => {
    const { host, vars } = makeHost();
    const triggers = [
      trig("start", [setv("s", "1")]),
      trig("output", [setv("o", "1")]),
      trig("manual", [setv("m", "1")], [], { comment: "doIt" }),
      trig("start", [setv("ms", "1")], [], { comment: "doIt" }),
    ];
    await runTriggers(triggers, "output", host);
    expect(vars).toEqual({ o: "1" });
    await runTriggers(triggers, "manual", host, { manualName: "doIt" });
    expect(vars).toEqual({ o: "1", m: "1", ms: "1" });
  });

  test("lua triggers are selected but skipped without error", async () => {
    const { host, vars } = makeHost();
    await runTriggers([trig("output", [{ type: "triggerlua", code: "x" }, setv("x", "1")])], "start", host);
    expect(vars.x).toBe("1");
  });
});

describe("V1 effects", () => {
  test("setvar operators (NaN original -> 0)", async () => {
    const { host, vars } = makeHost({ vars: { a: "10", b: "10", c: "10", d: "10", s: "abc" } });
    await runTriggers([trig("start", [
      setv("a", "5", "+="), setv("b", "3", "-="), setv("c", "2", "*="), setv("d", "4", "/="),
      setv("s", "2", "+="), setv("e", "{{getvar::a}}"),
    ])], "start", host);
    expect(vars).toMatchObject({ a: "15", b: "7", c: "20", d: "2.5", s: "2", e: "15" });
  });

  test("systemprompt accumulates per location with trailing blank line", async () => {
    const { host } = makeHost();
    const r = await runTriggers([trig("start", [
      { type: "systemprompt", location: "start", value: "A" },
      { type: "systemprompt", location: "start", value: "B" },
      { type: "systemprompt", location: "historyend", value: "H" },
      { type: "v2SystemPrompt", location: "promptend", value: "P", valueType: "value", indent: 0 },
    ])], "start", host);
    expect(r.systemPrompt).toEqual({ start: "A\n\nB\n\n", historyend: "H\n\n", promptend: "P\n\n" });
  });

  test("impersonate, cutchat, modifychat mutate host.chat in place", async () => {
    const chat: TriggerChat[] = [{ role: "user", data: "0" }, { role: "char", data: "1" }, { role: "user", data: "2" }];
    const { host } = makeHost({ chat });
    await runTriggers([trig("start", [
      { type: "impersonate", role: "char", value: "3" },
      { type: "cutchat", start: "1", end: "4" },
      { type: "modifychat", index: "0", value: "one" },
      { type: "modifychat", index: "99", value: "ignored" },
    ])], "start", host);
    expect(host.chat).toBe(chat);
    expect(chat).toEqual([{ role: "char", data: "one" }, { role: "user", data: "2" }, { role: "char", data: "3" }]);
  });

  test("stop and lowLevelAccess-gated sendAIprompt", async () => {
    const { host } = makeHost();
    const r1 = await runTriggers([trig("start", [{ type: "stop" }, { type: "sendAIprompt" }])], "start", host);
    expect(r1).toMatchObject({ stop: true, sendAIprompt: false });
    const r2 = await runTriggers([trig("start", [{ type: "sendAIprompt" }], [], { lowLevelAccess: true })], "start", host);
    expect(r2.sendAIprompt).toBe(true);
  });

  test("showAlert input/select and extractRegex need lowLevelAccess", async () => {
    const { host, vars, alerts } = makeHost({ inputs: ["typed", "B"] });
    const effects = [
      { type: "showAlert", alertType: "normal", value: "hi", inputVar: "" },
      { type: "showAlert", alertType: "input", value: "name?", inputVar: "in" },
      { type: "showAlert", alertType: "select", value: "A§B", inputVar: "sel" },
      { type: "extractRegex", value: "hp=42", regex: "hp=(\\d+)", flags: "", result: "[$1|$&|$$]", inputVar: "rx" },
    ];
    await runTriggers([trig("start", effects)], "start", host);
    expect(alerts).toEqual([]);
    await runTriggers([trig("start", effects, [], { lowLevelAccess: true })], "start", host);
    expect(alerts).toEqual(["normal:hi", "input:name?", "select:A,B"]);
    expect(vars).toMatchObject({ in: "typed", sel: "B", rx: "[42|hp=42|$]" });
  });

  test("runLLM falls back to an error string; uses host.runLLM when given", async () => {
    const { host, vars } = makeHost();
    const t = [trig("start", [{ type: "runLLM", value: "q", inputVar: "out" }], [], { lowLevelAccess: true })];
    await runTriggers(t, "start", host);
    expect(vars.out).toMatch(/^Error/);
    host.runLLM = async (p) => "answer:" + p;
    await runTriggers(t, "start", host);
    expect(vars.out).toBe("answer:q");
  });
});

describe("runtrigger", () => {
  test("runs manual trigger by comment, sharing chat and system prompt", async () => {
    const { host, vars } = makeHost();
    const r = await runTriggers([
      trig("start", [{ type: "runtrigger", value: "sub" }, setv("after", "{{getvar::fromSub}}")]),
      trig("manual", [setv("fromSub", "yes"), { type: "impersonate", role: "user", value: "x" },
        { type: "systemprompt", location: "start", value: "S" }, { type: "stop" }], [], { comment: "sub" }),
    ], "start", host);
    expect(vars).toMatchObject({ fromSub: "yes", after: "yes" });
    expect(host.chat).toEqual([{ role: "user", data: "x" }]);
    expect(r.systemPrompt.start).toBe("S\n\n");
    expect(r.stop).toBe(true);
  });

  test("recursion is capped (depth 10 without lowLevelAccess)", async () => {
    const { host, vars } = makeHost();
    await runTriggers([
      trig("manual", [setv("n", "1", "+="), { type: "runtrigger", value: "loop" }], [], { comment: "loop" }),
    ], "manual", host, { manualName: "loop" });
    expect(vars.n).toBe("11");
  });

  test("v2RunTrigger works too", async () => {
    const { host, vars } = makeHost();
    await runTriggers([
      trig("start", [{ type: "v2RunTrigger", target: "t", indent: 0 }]),
      trig("manual", [setv("x", "1")], [], { comment: "t" }),
    ], "start", host);
    expect(vars.x).toBe("1");
  });
});

// helpers for V2
const sv = (v: string, value: string, operator = "=", indent = 0, valueType = "value") =>
  ({ type: "v2SetVar", var: v, value, valueType, operator, indent });
const ifv = (source: string, condition: string, target: string, indent = 0) =>
  ({ type: "v2If", source, condition, target, targetType: "value", indent });
const end = (indent: number, endOfLoop = false) => ({ type: "v2EndIndent", indent, endOfLoop });
const els = (indent: number) => ({ type: "v2Else", indent });

describe("V2 control flow", () => {
  test("if / else", async () => {
    const { host, vars } = makeHost({ vars: { hp: "5" } });
    const effects = [
      ifv("hp", ">", "3"),
      sv("r", "big", "=", 1),
      end(1),
      els(0),
      sv("r", "small", "=", 1),
      end(1),
      sv("after", "1"),
    ];
    await runTriggers([trig("start", effects)], "start", host);
    expect(vars).toMatchObject({ r: "big", after: "1" });
    vars.hp = "1";
    await runTriggers([trig("start", effects)], "start", host);
    expect(vars.r).toBe("small");
  });

  test("v2If '=' compares numerically when both are numbers", async () => {
    const { host, vars } = makeHost({ vars: { x: "1.0" } });
    await runTriggers([trig("start", [ifv("x", "=", "1"), sv("ok", "1", "=", 1), end(1)])], "start", host);
    expect(vars.ok).toBe("1");
  });

  test("v2IfAdvanced operators", async () => {
    const { host, vars } = makeHost({ vars: { arr: '["a","b"]' } });
    const adv = (out: string, source: string, sourceType: string, condition: string, target: string) => [
      { type: "v2IfAdvanced", source, sourceType, condition, target, targetType: "value", indent: 0 },
      sv(out, "1", "=", 1), end(1),
    ];
    await runTriggers([trig("start", [
      ...adv("in", "a", "value", "∈", '["a"]'),
      ...adv("contains", "arr", "var", "∋", "b"),
      ...adv("notin", "z", "value", "∉", '["a"]'),
      ...adv("approx", "Hello World", "value", "≒", "helloworld"),
      ...adv("truthy", "1", "value", "≡", "true"),
      ...adv("never", "a", "value", "∈", "not json"),
    ])], "start", host);
    expect(vars).toMatchObject({ in: "1", contains: "1", notin: "1", approx: "1", truthy: "1" });
    expect(vars.never).toBeUndefined();
  });

  test("v2LoopNTimes and v2Loop with break", async () => {
    const { host, vars } = makeHost();
    await runTriggers([trig("start", [
      { type: "v2LoopNTimes", value: "3", valueType: "value", indent: 0 },
      sv("n", "1", "+=", 1),
      end(1, true),
      { type: "v2Loop", indent: 0 },
      sv("m", "1", "+=", 1),
      ifv("m", ">=", "5", 1),
      { type: "v2BreakLoop", indent: 2 },
      end(2),
      end(1, true),
      sv("done", "1"),
    ])], "start", host);
    expect(vars).toMatchObject({ n: "3", m: "5", done: "1" });
  });

  test("v2StopTrigger stops only the current trigger", async () => {
    const { host, vars } = makeHost();
    await runTriggers([
      trig("start", [sv("a", "1"), { type: "v2StopTrigger", indent: 0 }, sv("b", "1")]),
      trig("start", [sv("c", "1")]),
    ], "start", host);
    expect(vars).toEqual({ a: "1", c: "1" });
  });

  test("local variables shadow chat vars and are cleared at end of block", async () => {
    const { host, vars } = makeHost({ vars: { x: "global" } });
    await runTriggers([trig("start", [
      ifv("x", "=", "global"),
      { type: "v2DeclareLocalVar", var: "x", value: "local", valueType: "value", indent: 1 },
      sv("seen", "x", "=", 1, "var"),
      sv("x", "changed", "=", 1),
      sv("seen2", "x", "=", 1, "var"),
      end(1),
      sv("after", "x", "=", 0, "var"),
    ])], "start", host);
    expect(vars).toMatchObject({ x: "global", seen: "local", seen2: "changed", after: "global" });
  });

  test("v2StopPromptSending and v2UpdateGUI", async () => {
    const { host } = makeHost();
    const r = await runTriggers([trig("start", [{ type: "v2StopPromptSending", indent: 0 }, { type: "v2UpdateGUI", indent: 0 }])], "start", host);
    expect(r).toMatchObject({ stop: true, reload: true });
  });
});

describe("V2 data effects", () => {
  test("string effects", async () => {
    const { host, vars } = makeHost({ vars: { s: "Hello" } });
    const o = (type: string, extra: any) => ({ type, indent: 0, ...extra });
    await runTriggers([trig("start", [
      o("v2ToUpperCase", { source: "s", sourceType: "var", outputVar: "up" }),
      o("v2GetCharCount", { source: "s", sourceType: "var", outputVar: "len" }),
      o("v2GetCharAt", { source: "s", sourceType: "var", index: "1", indexType: "value", outputVar: "ch" }),
      o("v2SetCharAt", { source: "s", sourceType: "var", index: "0", indexType: "value", value: "J", valueType: "value", outputVar: "j" }),
      o("v2ConcatString", { source1: "s", source1Type: "var", source2: "!", source2Type: "value", outputVar: "cat" }),
      o("v2SplitString", { source: "a,b,c", sourceType: "value", delimiter: ",", delimiterType: "value", outputVar: "split" }),
      o("v2SplitString", { source: "a1b22c", sourceType: "value", delimiter: "/\\d+/", delimiterType: "regex", outputVar: "split2" }),
      o("v2Calculate", { expression: "($len + 1) * 2", expressionType: "value", outputVar: "calc" }),
    ])], "start", host);
    expect(vars).toMatchObject({
      up: "HELLO", len: "5", ch: "e", j: "Jello", cat: "Hello!",
      split: '["a","b","c"]', split2: '["a","b","c"]', calc: "12",
    });
  });

  test("array effects", async () => {
    const { host, vars } = makeHost();
    const o = (type: string, extra: any) => ({ type, indent: 0, var: "arr", ...extra });
    await runTriggers([trig("start", [
      o("v2MakeArrayVar", {}),
      o("v2PushArrayVar", { value: "a", valueType: "value" }),
      o("v2PushArrayVar", { value: "b", valueType: "value" }),
      o("v2UnshiftArrayVar", { value: "z", valueType: "value" }),
      o("v2GetArrayVarLength", { outputVar: "len" }),
      o("v2GetArrayVar", { index: "1", indexType: "value", outputVar: "at1" }),
      o("v2PopArrayVar", { outputVar: "popped" }),
      o("v2GetIndexOfValueInArrayVar", { value: "a", valueType: "value", outputVar: "idx" }),
      o("v2JoinArrayVar", { varType: "var", delimiter: "-", delimiterType: "value", outputVar: "joined" }),
    ])], "start", host);
    expect(vars).toMatchObject({ arr: '["z","a"]', len: "3", at1: "a", popped: "b", idx: "1", joined: "z-a" });
  });

  test("dict effects", async () => {
    const { host, vars } = makeHost();
    const o = (type: string, extra: any) => ({ type, indent: 0, var: "d", varType: "var", ...extra });
    await runTriggers([trig("start", [
      o("v2MakeDictVar", {}),
      o("v2SetDictVar", { key: "k", keyType: "value", value: "v", valueType: "value" }),
      o("v2SetDictVar", { key: "k2", keyType: "value", value: "v2", valueType: "value" }),
      o("v2GetDictVar", { key: "k", keyType: "value", outputVar: "got" }),
      o("v2HasDictKey", { key: "nope", keyType: "value", outputVar: "has" }),
      o("v2DeleteDictKey", { key: "k2", keyType: "value" }),
      o("v2GetDictSize", { outputVar: "size" }),
      o("v2GetDictKeys", { outputVar: "keys" }),
    ])], "start", host);
    expect(vars).toMatchObject({ d: '{"k":"v"}', got: "v", has: "0", size: "1", keys: '["k"]' });
  });

  test("regex effects", async () => {
    const { host, vars } = makeHost();
    const o = (type: string, extra: any) => ({ type, indent: 0, ...extra });
    await runTriggers([trig("start", [
      o("v2ExtractRegex", { value: "name: Bob", valueType: "value", regex: "name: (\\w+)", regexType: "value", flags: "", flagsType: "value", result: "<$1>", resultType: "value", outputVar: "ex" }),
      o("v2ExtractRegex", { value: "zzz", valueType: "value", regex: "(\\d)", regexType: "value", flags: "", flagsType: "value", result: "<$1>", resultType: "value", outputVar: "exMiss" }),
      o("v2RegexTest", { value: "ABC", valueType: "value", regex: "b", regexType: "value", flags: "i", flagsType: "value", outputVar: "t" }),
      o("v2ReplaceString", { source: "a1 b2", sourceType: "value", regex: "(\\w)(\\d)", regexType: "value", result: "$2$1", resultType: "value", replacement: "", replacementType: "value", flags: "g", flagsType: "value", outputVar: "rep" }),
    ])], "start", host);
    expect(vars).toMatchObject({ ex: "<Bob>", exMiss: "<>", t: "1", rep: "1a 2b" });
  });

  test("chat reading effects", async () => {
    const { host, vars } = makeHost({ chat: [{ role: "user", data: "u1" }, { role: "char", data: "c1" }, { role: "user", data: "u2" }] });
    const o = (type: string, extra: any = {}) => ({ type, indent: 0, ...extra });
    await runTriggers([trig("start", [
      o("v2GetLastMessage", { outputVar: "last" }),
      o("v2GetLastCharMessage", { outputVar: "lastChar" }),
      o("v2GetMessageCount", { outputVar: "count" }),
      o("v2GetMessageAtIndex", { index: "1", indexType: "value", outputVar: "at" }),
      o("v2GetFirstMessage", { outputVar: "first" }),
      o("v2QuickSearchChat", { value: "C1", valueType: "value", condition: "loose", depth: "2", depthType: "value", outputVar: "found" }),
    ])], "start", host);
    expect(vars).toMatchObject({ last: "u2", lastChar: "c1", count: "3", at: "c1", first: "Hello there", found: "1" });
  });
});

describe("display / request modes", () => {
  test("display mode only runs allow-listed effects and edits displayData", async () => {
    const { host, vars } = makeHost();
    const r = await runTriggers([trig("display", [
      { type: "v2GetDisplayState", outputVar: "d", indent: 0 },
      { type: "v2ReplaceString", indent: 0 }, // not in allow-list: skipped silently
      { type: "v2Impersonate", role: "user", value: "x", valueType: "value", indent: 0 }, // skipped
      setv("v1", "1"), // V1 not allowed in display mode
      { type: "v2ConcatString", source1: "d", source1Type: "var", source2: "!", source2Type: "value", outputVar: "d2", indent: 0 },
      { type: "v2SetDisplayState", value: "d2", valueType: "var", indent: 0 },
    ])], "display", host, { displayData: "shown" });
    expect(r.displayData).toBe("shown!");
    expect(host.chat).toEqual([]);
    // display-mode setVar writes only to a temporary store, never to chat variables
    expect(vars).toEqual({});
  });

  test("v2SetDisplayState outside display mode aborts the whole run", async () => {
    const { host, vars } = makeHost();
    const r = await runTriggers([trig("start", [
      { type: "v2Impersonate", role: "user", value: "x", valueType: "value", indent: 0 },
      { type: "v2SystemPrompt", location: "start", value: "S", valueType: "value", indent: 0 },
      { type: "v2SetDisplayState", value: "x", valueType: "value", indent: 0 },
      sv("never", "1"),
    ])], "start", host);
    expect(vars.never).toBeUndefined();
    expect(host.chat).toEqual([]);
    expect(r.systemPrompt.start).toBe("");
  });

  test("request mode reads and edits the request JSON", async () => {
    const { host } = makeHost();
    const req = JSON.stringify([{ role: "system", content: "sys" }, { role: "user", content: "hi" }]);
    const r = await runTriggers([trig("request", [
      { type: "v2GetRequestStateLength", outputVar: "n", indent: 0 },
      { type: "v2GetRequestState", index: "1", indexType: "value", outputVar: "c", indent: 0 },
      { type: "v2SetRequestState", index: "1", indexType: "value", value: "c", valueType: "var", indent: 0 },
      { type: "v2SetRequestStateRole", index: "0", indexType: "value", value: "assistant", valueType: "value", indent: 0 },
      { type: "v2GetDisplayState", outputVar: "x", indent: 0 }, // not in request allow-list
    ])], "request", host, { displayData: req });
    expect(JSON.parse(r.displayData!)).toEqual([{ role: "assistant", content: "sys" }, { role: "user", content: "hi" }]);
  });
});
