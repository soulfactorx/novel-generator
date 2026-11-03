// @vitest-environment jsdom
import { expect, test } from "vitest";
import { colorizeHtml, findQuotes, splitDialogue } from "../src/lib/dialogue";

test("대사(따옴표)만 골라낸다: \"…\" “…” 「…」 『…』, 줄을 넘는 따옴표는 대사가 아님", () => {
  const t = '서율이 말했다. "가자." 그리고 “응.” 「네」 『책』 "끝나지 않은\n따옴표';
  expect(findQuotes(t).map((q) => t.slice(q.start, q.end))).toEqual(['"가자."', "“응.”", "「네」", "『책』"]);
});
test("일반 글 조각 나누기", () => {
  expect(splitDialogue('도윤이 말했다. "가자." 끝')).toEqual([{ text: "도윤이 말했다. " }, { text: '"가자."', quote: true }, { text: " 끝" }]);
  expect(splitDialogue("대사 없음")).toEqual([{ text: "대사 없음" }]);
});
test("HTML: 여러 글자 노드에 걸친 대사도 감싸고, 버튼·코드 안은 그대로", () => {
  const out = colorizeHtml('<p>도윤이 <b>대답했다</b>. "응, <i>그래</i>."</p><button>"버튼"</button><code>"x"</code>');
  expect(out).toContain('<span class="dlg">"응, </span><i><span class="dlg">그래</span></i><span class="dlg">."</span>');
  expect(out).toContain('<button>"버튼"</button>');
  expect(out).toContain('<code>"x"</code>');
  expect(colorizeHtml("<p>대사 없음</p>")).toBe("<p>대사 없음</p>");
});
