// @vitest-environment jsdom
import { expect, test } from "vitest";
import { sanitizeHtml } from "../src/lib/images";

test("안전한 HTML: 스크립트·이벤트·외부 그림 제거, 그림 토큰은 실제 주소로", () => {
  const out = sanitizeHtml('<p onclick="x()">글</p><script>alert(1)</script><img src="nvimg:abc"><img src="https://evil/x.png"><iframe src="x"></iframe><a href="javascript:x">링크</a>', { abc: "blob:test/1" });
  expect(out).toContain('<img src="blob:test/1">');
  expect(out).not.toMatch(/script|onclick|evil|iframe|javascript/);
  expect(out).toContain("<p>글</p>");
  expect(out).toContain("링크"); // 모르는 태그는 벗기고 글은 남김
});

test("봇 상태창: <!DOCTYPE>·<html>·<head> 벗기고, <style>은 범위 한정, 블록 앞뒤 빈 줄 정리", () => {
  const html = '앞 문단.\n\n\n<!DOCTYPE html>\n<html lang="ko">\n<head>\n<meta charset="UTF-8">\n<title>상태창</title>\n<style>\nbody{margin:0}\n.status-window{background-color:#13a9b0}\n</style>\n</head>\n<body>\n\n<div class="status-window">\n  <span>체력</span>\n</div>\n</body>\n</html>\n\n뒤 문단.';
  const out = sanitizeHtml(html, {}, "rs9");
  expect(out).not.toMatch(/DOCTYPE|<html|<head|<body|<meta|<title/);
  expect(out).toContain("<style>.rs9 .status-window{background-color:#13a9b0}</style>");
  expect(out).not.toContain("margin:0");
  expect(out.startsWith("앞 문단.<style>")).toBe(true); // 상태창 앞 빈 줄 없음
  expect(out).toMatch(/<\/div>뒤 문단\.$/);
  expect(sanitizeHtml("<style>.a{color:red}</style>x", {})).toBe("x"); // 범위가 없으면 스타일은 버림
});

test("봇의 고정 위치·화면 단위는 이야기 화면 기준으로", () => {
  const out = sanitizeHtml('<div style="position:fixed;right:0;height:100dvh;width:calc(100vw - 76px);background:url(https://x/y.png)">탭</div>', {});
  expect(out).toContain("position:var(--risu-fixed,absolute)");
  expect(out).toContain("height:100cqh");
  expect(out).toContain("width:calc(100cqw - 76px)");
  expect(out).not.toContain("https://x");
});

test("값 없는 속성(checked·open·controls)은 남긴다", () => {
  const out = sanitizeHtml('<input type="radio" name="g" checked data-x><details open><summary>s</summary>b</details><audio src="nvimg:a" controls loop></audio>', { a: "blob:x/1" });
  expect(out).toContain('<input type="radio" name="g" checked="" data-x="">');
  expect(out).toContain("<details open=");
  expect(out).toMatch(/<audio src="blob:x\/1" controls="" loop="">/);
});
