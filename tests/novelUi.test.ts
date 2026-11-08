import { describe, expect, test } from "vitest";
import { isChatUiScript, novelPool, runScripts, type ImagePool } from "../src/lib/images";
import type { RegexScript } from "../src/lib/types";

const sc = (inp: string, out: string, type = "editdisplay"): RegexScript => ({ comment: "", in: inp, out, type });
const STATUS = sc("<MG>([\\s\\S]*?)</MG>", '<div class="st">$1</div>{{#if {{greater_equal::{{chat_index}}::0}}}}<div risu-btn="app">📒 명강 수첩 {{getvar::mg_place}}</div>{{/if}}');
const PHONE = sc("$", '<div class="phone">{{getvar::mg_date_raw}} {{getvar::mg_time}}</div>');
const IMG = sc('<img="(.+?)">', '{{#when::{{getvar::mg_img}}::isnot::off}}<img src="{{raw::$1}}">{{/when}}');
const WRAP = sc("^([\\s\\S]+)$", "$1<div>{{getvar::mg_hp}}</div>");

describe("novel: chat UI scripts", () => {
  test("classifies UI (buttons / reads chat vars without images) vs image scripts", () => {
    expect(isChatUiScript(STATUS)).toBe(true);
    expect(isChatUiScript(PHONE)).toBe(true);
    expect(isChatUiScript(WRAP)).toBe(true);
    expect(isChatUiScript(IMG)).toBe(false);
    expect(isChatUiScript(sc("a", "<b>$1</b>"))).toBe(false);
  });
  test("novelPool removes status blocks and UI but keeps prose and images", () => {
    const pool = novelPool({ assets: [], emotions: [], scripts: [STATUS, PHONE, IMG, WRAP] } as unknown as ImagePool);
    const text = '첫 문단.\n\n<img="cafe">\n\n마지막 문단.\n\n<MG>2026.03.10|16:40|맑음|자취방</MG>';
    const r = runScripts(text, pool.scripts, "editdisplay").text;
    expect(r).toContain("첫 문단.");
    expect(r).toContain("마지막 문단.");
    expect(r).toContain('<img src="{{raw::cafe}}">');
    expect(r).not.toMatch(/명강 수첩|2026\.03\.10|phone|getvar::mg_hp/);
  });
  test("chat rooms keep drawing the UI", () => {
    const r = runScripts("본문<MG>x</MG>", [STATUS], "editdisplay").text;
    expect(r).toContain("명강 수첩");
  });
});
