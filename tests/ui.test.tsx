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
  expect(document.body.textContent).toContain("라이브러리가 비어 있습니다");
  await act(async () => byText("시작하기")!.click());
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

const setVal = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

test("library: create world + character, start a story from it", async () => {
  await act(async () => byText("📚 라이브러리")!.click());
  await act(async () => byText("+ 추가")!.click());
  setVal(document.querySelector('[aria-label="세계관 이름"]') as HTMLInputElement, "레인포트");
  await wait();
  await act(async () => byText("+ 항목 추가")!.click());
  setVal(document.querySelector('[aria-label="로어 키워드"]') as HTMLInputElement, "조합, 길드");
  await wait();
  await act(async () => byText(/등장인물/)!.click());
  await act(async () => byText("+ 추가")!.click());
  setVal(document.querySelector('[aria-label="인물 이름"]') as HTMLInputElement, "서율");
  const sel = document.querySelector('[aria-label="소속 세계관"]') as HTMLSelectElement;
  await act(async () => { sel.value = [...sel.options].find((o) => o.text === "레인포트")!.value; sel.dispatchEvent(new Event("change", { bubbles: true })); });
  await wait();
  const { getState } = await import("../src/lib/store");
  const w = Object.values(getState().library).find((e) => e.kind === "world")!;
  expect(w).toMatchObject({ name: "레인포트" });
  expect((w as any).lore[0].keys).toEqual(["조합", "길드"]);
  await act(async () => byText(/세계관/)!.click());
  await act(async () => [...document.querySelectorAll("button")].find((b) => b.textContent?.startsWith("레인포트"))!.click());
  await act(async () => byText("이 설정으로 새 이야기")!.click());
  const room = getState().rooms[getState().activeRoomId!];
  expect(room.worldId).toBe(w.id);
  expect(room.characterIds).toHaveLength(1);
  expect(document.body.textContent).toContain("🎭 서율");
});
