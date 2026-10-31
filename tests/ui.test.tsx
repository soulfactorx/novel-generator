// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import App from "../src/App";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const wait = (ms = 30) => act(() => new Promise((r) => setTimeout(r, ms)));
const byText = (t: string | RegExp) => [...document.querySelectorAll("button")].find((b) => (typeof t === "string" ? b.textContent?.includes(t) : t.test(b.textContent || "")));

test("app boots, creates a story, settings rating is locked until adult confirmation", async () => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => createRoot(el).render(<App />));
  await wait(100);
  expect(document.body.textContent).toContain("AI와 함께 이야기를 써 보세요");
  await act(async () => byText("+ 새 이야기")!.click());
  expect(document.body.textContent).toContain("이야기 시작하기");
  await act(async () => byText("⚙️ 설정")!.click());
  await act(async () => byText("콘텐츠 수위")!.click());
  const adult = byText(/성인 \(19\+\)/)! as HTMLButtonElement;
  expect(adult.disabled).toBe(true);
  const confirm = [...document.querySelectorAll('input[type="checkbox"]')].pop() as HTMLInputElement;
  await act(async () => confirm.click());
  expect((byText(/성인 \(19\+\)/) as HTMLButtonElement).disabled).toBe(false);
  await act(async () => (byText(/성인 \(19\+\)/) as HTMLButtonElement).click());
  expect(document.body.textContent).toContain("콘텐츠 등급: 성인");
  await act(async () => confirm.click()); // 확인 해제 → 성숙으로 복귀
  expect(document.body.textContent).toContain("콘텐츠 등급: 성숙");
});
