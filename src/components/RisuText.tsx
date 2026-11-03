import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { rememberControl, restoreControls } from "../lib/uiMemory";
import { colorizeHtml } from "../lib/dialogue";
import { hasMarkup, poolIsEmpty, renderRisu, sanitizeHtml, type ImagePool } from "../lib/images";
import { useImageUrls } from "../lib/imageUrls";
import { inlineMarkdown } from "../lib/markdown";
import { playBgm } from "../lib/bgm";
import { useApp } from "../lib/store";
import StoryText from "./StoryText";

/**
 * AI 본문 표시 (RisuAI 순서): CBS({{…}}) → 봇의 표시 스크립트(editdisplay, 스크립트마다 CBS 다시) →
 * 그림 표시({{img::}} · <img src="이름"> · <Emotion>) → 마크다운 → 안전한 HTML.
 * 봇 버튼(risu-trigger)을 누르면 onTrigger로 알린다.
 */
export default function RisuText({ text: raw, pool, cbs, onTrigger, luaDisplay }: { text: string; pool?: ImagePool; cbs?: (s: string) => string; onTrigger?: (name: string, id: string | null, meta?: object) => void; luaDisplay?: (t: string) => Promise<string> }) {
  // 봇 Lua의 editDisplay (비동기): 결과가 오면 그것으로 다시 그림
  const [lua, setLua] = useState<{ src: string; fn: unknown; out: string } | null>(null);
  useEffect(() => {
    if (!luaDisplay) return;
    let alive = true;
    void luaDisplay(raw).then((out) => alive && setLua({ src: raw, fn: luaDisplay, out }));
    return () => {
      alive = false;
    };
  }, [raw, luaDisplay]);
  const text = luaDisplay && lua?.src === raw && lua.fn === luaDisplay ? lua.out : raw;
  const images = useApp((s) => s.images);
  const markdown = useApp((s) => s.settings.risu.markdown);
  const scope = "rs" + useId().replace(/[^a-z0-9]/gi, ""); // 봇 <style>을 이 메시지 안으로 한정
  const r = useMemo(() => {
    if ((!pool || poolIsEmpty(pool)) && !cbs) return null;
    const out = pool ? renderRisu(text, pool, cbs) : { html: cbs ? cbs(text) : text, ids: [] as string[] };
    return { ...out, html: markdown ? inlineMarkdown(out.html) : out.html };
  }, [text, pool, cbs, markdown]);
  const md = useMemo(() => (!r && markdown ? inlineMarkdown(text) : null), [r, markdown, text]);
  const urls = useImageUrls(r ? r.ids.map((id) => images[id]) : []);
  const html = r ? r.html : md;
  // {{bgm::이름}} → 배경 음악 (주소가 준비되면)
  const bgmId = r && /risu-ctrl="bgm___auto___nvimg:([a-z0-9]+)"/i.exec(r.html)?.[1];
  const bgmUrl = bgmId ? urls[bgmId] : undefined;
  useEffect(() => {
    if (bgmUrl) playBgm(bgmUrl);
  }, [bgmUrl]);
  const dialogueColor = useApp((s) => s.settings.dialogueColors);
  const safe = html !== null && hasMarkup(html) ? sanitizeHtml(tidy(html), urls, scope) : null;
  const clean = safe !== null && dialogueColor ? colorizeHtml(safe) : safe; // 대사 색
  // 봇 화면의 탭 접기 등: 새로 그려도 마지막으로 고른 상태 유지
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (box.current) restoreControls(box.current);
  }, [clean]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onChange = (e: Event) => rememberControl(e.target as Element, el); // React 밖에서 만든 입력이라 직접 듣는다
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, [clean === null]);
  if (clean === null) return <StoryText text={html ?? text} />;
  const click = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest("[risu-trigger],[risu-btn]") as HTMLElement | null;
    if (!el || !onTrigger) return;
    e.preventDefault();
    const trig = el.getAttribute("risu-trigger");
    // risu-trigger: 그 이름의 트리거(Lua 함수) / risu-btn: Lua onButtonClick(값)
    onTrigger(trig ?? `__btn:${el.getAttribute("risu-btn") ?? ""}`, el.getAttribute("risu-id"));
  };
  // <form risu-form="이름"> 제출 → Lua onFormSubmit(이름, { data: 입력값 }) (RisuAI와 같음). 페이지 이동은 항상 막음
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const name = form.getAttribute?.("risu-form");
    if (!name || !onTrigger) return;
    const data: Record<string, string | string[]> = {};
    for (const [k, v] of new FormData(form, (e.nativeEvent as SubmitEvent).submitter ?? undefined)) {
      const val = String(v);
      data[k] = k in data ? [...(Array.isArray(data[k]) ? data[k] : [data[k] as string]), val] : val;
    }
    onTrigger(`__form:${name}`, null, { data });
  };
  return <div ref={box} className={`story risu-html whitespace-pre-wrap ${scope}`} onClick={click} onSubmitCapture={submit} dangerouslySetInnerHTML={{ __html: clean }} />;
}

/** 그림은 블록으로 보이므로 앞뒤 빈 줄을 줄인다 (pre-wrap에서 빈 공간이 커지지 않게) */
const tidy = (html: string) =>
  html
    .trim()
    .replace(/>[ \t]*\n\s*</g, ">\n<") // 태그 사이 빈 줄 줄이기
    .replace(/[ \t]*\n+[ \t]*(<img\b[^>]*>)[ \t]*\n*/g, "\n$1")
    .replace(/(<img\b[^>]*>)\n+/g, "$1");
