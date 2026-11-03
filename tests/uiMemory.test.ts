// @vitest-environment jsdom
import { beforeEach, expect, test } from "vitest";
import { rememberControl, resetUiMemory, restoreControls } from "../src/lib/uiMemory";

const shell = (turn: number, checked: string) =>
  ["none", "menu", "map"].map((k) => `<input class="dmt-radio" type="radio" name="s${turn}" id="s${turn}-${k}" data-dmt-popup="${k}"${k === checked ? " checked" : ""}>`).join("") +
  `<input type="checkbox" class="plain" id="w${turn}">`;

beforeEach(() => resetUiMemory());

test("턴마다 새로 그려도 마지막으로 고른 탭 상태(라디오)를 유지, data-* 없는 컨트롤은 기억하지 않음", () => {
  const a = document.createElement("div");
  a.innerHTML = shell(1, "none");
  const menu = a.querySelector<HTMLInputElement>("#s1-menu")!;
  menu.checked = true;
  rememberControl(menu, a);
  const plain = a.querySelector<HTMLInputElement>("#w1")!;
  plain.checked = true;
  rememberControl(plain, a);
  // 다음 턴: 봇이 이름·id를 바꿔 기본값(none)으로 다시 그림
  const b = document.createElement("div");
  b.innerHTML = shell(2, "none");
  restoreControls(b);
  expect(b.querySelector<HTMLInputElement>("#s2-menu")!.checked).toBe(true);
  expect(b.querySelector<HTMLInputElement>("#s2-none")!.checked).toBe(false);
  expect(b.querySelector<HTMLInputElement>("#w2")!.checked).toBe(false);
  // 다시 접으면 접힌 상태 유지
  const none = b.querySelector<HTMLInputElement>("#s2-none")!;
  none.checked = true;
  rememberControl(none, b);
  const c = document.createElement("div");
  c.innerHTML = shell(3, "menu");
  restoreControls(c);
  expect(c.querySelector<HTMLInputElement>("#s3-none")!.checked).toBe(true);
});
