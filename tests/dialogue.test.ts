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
    expect(findDialogue('도윤수가 웃었다. "아."', sp).map((x) => x.speaker.name)).toEqual(["도윤수"]); // 도윤이 아니라 새 인물 도윤수
    expect(findDialogue('도윤이 말했다. "아."', sp)).toHaveLength(1);
  });
  test("일반 글 조각 나누기", () => {
    const parts = splitDialogue('도윤이 말했다. "가자."', sp);
    expect(parts.map((p) => [p.text, p.speaker?.name])).toEqual([["도윤이 말했다. ", undefined], ['"가자."', "도윤"]]);
  });
  test("HTML: 이름표(plate) 뒤 대사, 여러 글자 노드, 직접 고른 색", () => {
    const html = '<div class="dmt-character"><img src="x"><div class="dmt-character-plate">하소월</div></div>\n"밥 먹었어?"\n<p>도윤이 <b>대답했다</b>. "응."</p><button>"버튼"</button>';
    const out = colorizeHtml(html, sp);
    expect(out).toMatch(/<span class="dlg" style="--dlg-h:\d+" title="하소월">"밥 먹었어\?"<\/span>/);
    expect(out).toContain('<span class="dlg" style="color:#ff0000" title="도윤">"응."</span>');
    expect(out).toContain('<button>"버튼"</button>'); // 버튼 글자는 건드리지 않음
  });
});

describe("목록에 없는 화자 배우기 · 이어지는 대사", () => {
  test("말하기 표현에서 이름을 배우고, 다른 메시지에서도 같은 색", () => {
    const base = makeSpeakers([{ name: "치매검후: 재 (The Withering)" }]);
    const a = findDialogue('이장평이 기침하며 말했다. "부탁하마."', base);
    expect(a.map((x) => x.speaker.name)).toEqual(["이장평"]);
    const b = findDialogue('이장평은 고개를 숙였다.\n"미안하네."', base); // 말하기 표현 없이 이름만 나와도
    expect(b.map((x) => x.speaker.name)).toEqual(["이장평"]);
    expect(b[0].speaker.hue).toBe(a[0].speaker.hue);
    expect(findDialogue('그녀가 말했다. "응."', base)).toEqual([]); // 대명사는 이름이 아님
  });
  test("봇 이름표로 배운 이름은 그림 없는 다음 메시지에서도", () => {
    const base = makeSpeakers([{ name: "도윤" }]);
    colorizeHtml('<div class="x-plate">임옥선</div>\n"밥줘."', base);
    expect(findDialogue('임옥선은 숟가락을 두드렸다. "밥."', base).map((x) => x.speaker.name)).toEqual(["임옥선"]);
  });
  test("같은 줄에서 이어지는 대사는 앞 대사와 같은 화자, 줄이 바뀌면 이어 쓰지 않음", () => {
    const base = makeSpeakers([{ name: "도윤" }]);
    const t = '"가자." 도윤이 일어섰다. "늦었어."\n"어디로?"';
    expect(findDialogue(t, base).map((x) => [t.slice(x.start, x.end), x.speaker.name])).toEqual([['"가자."', "도윤"], ['"늦었어."', "도윤"]]);
  });
});

describe("봇 로어북 인물 · 주어만 화자", () => {
  test("로어북 NAME_KO·NAME_EN·ALIASES에서 인물", async () => {
    const { loreSpeakers } = await import("../src/lib/dialogue");
    expect(loreSpeakers([{ content: "ID: lee_jangpyeong\nNAME_KO: 이장평\nNAME_EN: Lee Jangpyeong\nALIASES: 장문인, 장평" }, { content: "그냥 설정" }, { content: "NAME_KO: 송무문 대전\nX_PCT: 40" }])).toEqual([{ name: "이장평", aliases: "Lee Jangpyeong,장문인,장평" }]);
    // 인물용 항목(CHR)이 따로 있으면 그것만
    expect(loreSpeakers([{ title: "CHR", content: "NAME_KO: 유승" }, { title: "LORE", content: "NAME: 송화검" }]).map((x) => x.name)).toEqual(["유승"]);
  });
  test("대사 앞의 듣는 사람(에게·을)은 화자가 아니고, 주어로 쓰인 이름이 화자", () => {
    const base = makeSpeakers([{ name: "주인공" }, { name: "이장평" }]);
    const t = '이장평은 주인공에게 다가갔다.\n\n"별채에서 모셔라."';
    expect(findDialogue(t, base).map((x) => x.speaker.name)).toEqual(["이장평"]);
    expect(findDialogue('주인공에게 손을 내밀었다. "가자."', base)).toEqual([]);
  });
});
