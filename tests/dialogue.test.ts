// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { colorizeHtml, findDialogue, makeSpeakers, nameVariants, splitDialogue } from "../src/lib/dialogue";

const sp = makeSpeakers([{ name: "임옥선" }, { name: "도윤", color: "#ff0000" }, { name: "치매검후: 재 (The Withering Sword Empress: Re)" }]);

describe("화자별 대사 색", () => {
  test("이름 변형: 세 글자 이름은 이름 두 글자도, 부제는 버림", () => {
    expect(nameVariants("임옥선")).toEqual(["임옥선", "옥선"]);
    expect(nameVariants("치매검후: 재 (The Withering)")).toEqual(["치매검후"]);
    expect(nameVariants("서율", "율이, 감찰관")).toEqual(["감찰관", "서율", "율이"]);
  });
  test("대사 뒤 이름 → 앞 이름 순으로 화자, 직전 대사 너머의 이름은 쓰지 않음, 못 찾으면 색 없음", () => {
    const t = '옥선은 숟가락을 바라보았다. "밥줘."\n\n"네, 네." 도윤이 웃었다.\n\n"그래도…"\n\n바람이 불었다. "누구지?"';
    const f = findDialogue(t, sp).map((x) => [t.slice(x.start, x.end), x.speaker.name]);
    expect(f).toEqual([['"밥줘."', "임옥선"], ['"네, 네."', "도윤"]]);
  });
  test("다른 낱말의 일부는 이름으로 보지 않음", () => {
    expect(findDialogue('도윤수가 웃었다. "아."', sp)).toEqual([]);
    expect(findDialogue('도윤이 말했다. "아."', sp)).toHaveLength(1);
  });
  test("일반 글 조각 나누기", () => {
    const parts = splitDialogue('도윤이 말했다. "가자."', sp);
    expect(parts.map((p) => [p.text, p.speaker?.name])).toEqual([["도윤이 말했다. ", undefined], ['"가자."', "도윤"]]);
  });
  test("HTML: 이름표(plate) 뒤 대사, 여러 글자 노드, 직접 고른 색", () => {
    const html = '<div class="dmt-character"><img src="x"><div class="dmt-character-plate">하소월</div></div>\n"밥 먹었어?"\n<p>도윤이 <b>대답했다</b>. "응."</p><button>"버튼"</button>';
    const out = colorizeHtml(html, sp);
    expect(out).toMatch(/<span class="dlg" style="--dlg-h:\d+">"밥 먹었어\?"<\/span>/);
    expect(out).toContain('<span class="dlg" style="color:#ff0000">"응."</span>');
    expect(out).toContain('<button>"버튼"</button>'); // 버튼 글자는 건드리지 않음
  });
});
