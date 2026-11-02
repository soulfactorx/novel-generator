import { describe, expect, test } from "vitest";
import { calcString, parseCbs, parseKeyValue, parseToggles, risuUnescape, type CbsEnv } from "../src/lib/cbs";
import { buildEnv, chatIndexOf, processContext, splitGreeting } from "../src/lib/risuRuntime";
import type { Character, Message } from "../src/lib/types";

const env = (o: Partial<CbsEnv> & { vars?: Record<string, string>; globals?: Record<string, string> } = {}): CbsEnv => {
  const vars = o.vars ?? {};
  const globals = o.globals ?? {};
  return { user: "도윤", char: "서율", getVar: (k) => vars[k] ?? "null", setVar: (k, v) => (vars[k] = v), getGlobal: (k) => globals[k] ?? "null", ...o };
};
const p = (s: string, e: CbsEnv = env()) => parseCbs(s, e);

describe("CBS 기본", () => {
  test("이름·안쪽부터 계산·<user> 표기", () => {
    expect(p("{{user}}와 {{char}}, <user>/<char>")).toBe("도윤와 서율, 도윤/서율");
    expect(p("{{upper::{{lower::ABC}}}}")).toBe("ABC");
    expect(p("{{ char }}")).toBe("서율"); // RisuAI처럼 함수 이름의 공백·_·-는 무시
    expect(p("{{없는함수::x}} {not}")).toBe("{{없는함수::x}} {not}");
  });
  test("비교·논리·계산", () => {
    expect(p("{{equal::a::a}}{{notequal::a::b}}{{greater::3::2}}{{less_equal::2::2}}{{and::1::0}}{{or::1::0}}{{not::1}}")).toBe("1111010");
    expect(p("{{any::0::1::0}}{{all::1::1}}{{any::[\"0\",\"1\"]}}")).toBe("111");
    expect(p("{{? 1 + 2 * 3}}|{{? (1+2)*3}}|{{calc::10 % 4}}|{{? 3 > 2 && 1}}|{{? -2 + 5}}")).toBe("7|9|2|1|3");
    expect(calcString("$hp - 10", env({ vars: { hp: "50" } }))).toBe(40);
    expect(p("{{round::2.6}} {{floor::2.6}} {{abs::-3}} {{pow::2::10}} {{fixnum::3.14159::2}}")).toBe("3 2 3 1024 3.14");
  });
  test("문자열·배열·사전", () => {
    expect(p("{{replace::가나다::나::X}} {{length::abcd}} {{startswith::hello::he}} {{contains::hello::ll}} {{reverse::abc}} {{capitalize::abc}}")).toBe("가X다 4 1 1 cba Abc");
    expect(p("{{split::a,b,c::,}}")).toBe('["a","b","c"]');
    expect(p("{{join::[\"a\",\"b\"]::-}} {{arraylength::[1,2,3]}} {{arrayelement::[\"x\",\"y\"]::1}} {{arraypush::[\"a\"]::b}}")).toBe('a-b 3 y ["a","b"]');
    expect(p("{{dictelement::{{makedict::hp=10::mp=3}}::mp}} {{element::[\"x\",\"y\"]::1}}")).toBe("3 y");
    expect(p("{{range::[3]}} {{sum::1::2::3}} {{max::[1,5,2]}}")).toBe('["0","1","2"] 6 5');
  });
});

describe("CBS 블록", () => {
  test("#when 연산자: is · isnot · not · and · or · > · <= · var · toggle · tis · tisnot · vis", () => {
    const e = env({ vars: { mood: "good", n: "1" }, globals: { toggle_lang: "1", toggle_npc: "1" } });
    expect(p("{{#when::a::is::a}}O{{/when}}{{#when::a::isnot::a}}X{{/when}}{{#when::not::0}}O{{/when}}", e)).toBe("OO");
    expect(p("{{#when::1::and::0}}X{{/when}}{{#when::1::or::0}}O{{/when}}{{#when::5::>::3}}O{{/when}}{{#when::3::<=::3}}O{{/when}}", e)).toBe("OOO");
    expect(p("{{#when::var::n}}O{{/when}}{{#when::toggle::npc}}O{{/when}}{{#when::lang::tis::1}}EN{{/when}}{{#when::lang::tisnot::1}}KO{{/when}}{{#when::mood::vis::good}}G{{/when}}", e)).toBe("OOENG");
    expect(p("{{#when::{{getglobalvar::toggle_lang}}::is::1}}EN{{:else}}KO{{/when}}", e)).toBe("EN");
    expect(p("{{#when::lang::tis::0}}EN{{:else}}KO{{/when}}", e)).toBe("KO");
  });
  test("#when 여러 줄: 앞뒤 빈 줄 정리, :else 줄, keep", () => {
    expect(p("{{#when::1}}\n\n본문\n\n{{/when}}")).toBe("본문");
    expect(p("{{#when::0}}\n가\n{{:else}}\n나\n{{/when}}")).toBe("나");
    expect(p("{{#when::keep::1}}\n\n본문\n{{/when}}")).toBe("\n\n본문\n");
    expect(p("앞{{#when::0}}\n숨김\n{{/when}}뒤")).toBe("앞뒤");
  });
  test("중첩과 #if · 옛 문법 · #pure · #escape · #each · #func/call", () => {
    expect(p("{{#if 1}}A{{#if 0}}B{{/if}}C{{/if}}")).toBe("AC");
    expect(p("{#if 1\n보임#}{#if 0\n숨김#}")).toBe("보임");
    expect(p("{{#pure}}{{user}}{{/pure}}")).toBe("{{user}}");
    expect(risuUnescape(p("{{#escape}}{a}(b){{/escape}}"))).toBe("{a}(b)");
    expect(p("{{#each [\"a\",\"b\"] as x}}[{{slot::x}}]{{/each}}")).toBe("[a][b]");
    expect(p("{{#func hi}}안녕 {{arg::1}}{{/func}}{{call::hi::철수}}")).toBe("안녕 철수");
  });
});

describe("변수", () => {
  test("setvar는 runVar일 때만 기록, rmVar면 지우기만, 아니면 그대로 둠", () => {
    const vars: Record<string, string> = {};
    expect(p("{{setvar::hp::10}}{{addvar::hp::5}}{{getvar::hp}}", env({ vars, runVar: true }))).toBe("15");
    expect(vars.hp).toBe("15");
    const v2: Record<string, string> = {};
    expect(p("{{setvar::hp::10}}남음", env({ vars: v2, rmVar: true }))).toBe("남음");
    expect(v2.hp).toBeUndefined();
    expect(p("{{setvar::hp::10}}", env())).toBe("{{setvar::hp::10}}");
    const v3: Record<string, string> = { a: "1" };
    p("{{setdefaultvar::a::9}}{{setdefaultvar::b::9}}", env({ vars: v3, runVar: true }));
    expect(v3).toEqual({ a: "1", b: "9" });
  });
  test("tempvar · return", () => {
    expect(p("{{settempvar::t::x}}{{tempvar::t}}")).toBe("x");
    expect(p("앞{{return::끝}}뒤")).toBe("끝");
  });
  test("기본 변수 · 토글 문법 · key=value", () => {
    expect(parseKeyValue("perma=fm_karenya\nhp=100\n잘못된줄")).toEqual([["perma", "fm_karenya"], ["hp", "100"]]);
    const t = parseToggles("=파멸로판=divider\n=기본 설정=group\nkc_language=언어=select=한국어,English\n=설명=caption\nkc_npc1=외정=toggle\nkc_ability=능력=textarea\n==groupEnd\nlast=끝=text");
    expect(t).toEqual([
      { type: "divider", label: "파멸로판" },
      { type: "group", label: "기본 설정", children: [{ type: "select", key: "kc_language", label: "언어", options: ["한국어", "English"] }, { type: "caption", label: "설명" }, { type: "check", key: "kc_npc1", label: "외정" }, { type: "textarea", key: "kc_ability", label: "능력" }] },
      { type: "text", key: "last", label: "끝" },
    ]);
  });
});

describe("이야기방 실행 환경", () => {
  const c = (o: Partial<Character> = {}): Character => ({ kind: "character", id: "c", name: "봇", summary: "", profile: "", speech: "", lore: [], createdAt: 0, updatedAt: 0, ...o });
  const msgs: Message[] = [
    { id: "g", role: "assistant", text: "인사", greeting: true, createdAt: 1 },
    { id: "u", role: "user", text: "안녕", createdAt: 2 },
    { id: "a", role: "assistant", text: "응", createdAt: 3 },
  ];
  test("인사말은 대화 번호 -1, 그 다음부터 0…; lastmessageid · previoususerchat", () => {
    expect(splitGreeting(msgs).first?.id).toBe("g");
    expect([chatIndexOf(msgs, "g"), chatIndexOf(msgs, "u"), chatIndexOf(msgs, "a")]).toEqual([-1, 0, 1]);
    const e = buildEnv({ ctx: { characters: [c()] }, messages: msgs, globals: {}, chatIndex: 1 });
    expect(p("{{lastmessageid}}|{{chat_index}}|{{previoususerchat}}|{{lastmessage}}", e)).toBe("1|1|안녕|응");
  });
  test("기본 변수와 토글로 설정 글 정리, 비게 된 로어는 뺌", () => {
    const ch = c({ profile: "{{#when::lang::tis::1}}English{{:else}}한국어{{/when}} · {{getvar::perma}}", lore: [{ id: "l", title: "npc", keys: ["x"], content: "{{#when::keep::toggle::npc1}}\n기사{{/when}}", enabled: true }], risu: { defaultVariables: "perma=fm_karenya" } });
    const ctx = { characters: [ch] };
    const off = processContext(ctx, buildEnv({ ctx, globals: {}, rmVar: true }));
    expect(off.characters[0].profile).toBe("한국어 · fm_karenya");
    expect(off.characters[0].lore).toHaveLength(0);
    const on = processContext(ctx, buildEnv({ ctx, globals: { toggle_lang: "1", toggle_npc1: "1" }, vars: { perma: "fm_free" }, rmVar: true }));
    expect(on.characters[0].profile).toBe("English · fm_free");
    expect(on.characters[0].lore[0].content).toBe("기사");
  });
});
