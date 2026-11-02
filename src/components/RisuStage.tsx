/**
 * 채팅 화면 연출 (RisuAI 방식)
 * - RisuBackground: 봇의 배경 HTML(backgroundHTML) — {{bg::이름}} 은 화면 배경 그림, {{bgm::}} 은 배경 음악
 * - EmotionPanel: 감정 이미지를 본문 대신 옆 패널에 (RisuAI 기본 감정 화면)
 * - BgmButton: 배경 음악 켜기/끄기
 */
import { useEffect, useMemo } from "react";
import { renderRisu, sanitizeHtml, type ImagePool } from "../lib/images";
import { useImageUrls } from "../lib/imageUrls";
import { playBgm, stopBgm, toggleBgmMute, useBgm } from "../lib/bgm";
import { useApp } from "../lib/store";
import type { Message } from "../lib/types";

export function RisuBackground({ src, pool, cbs, scope }: { src: string; pool: ImagePool; cbs?: (s: string) => string; scope: string }) {
  const images = useApp((s) => s.images);
  const r = useMemo(() => renderRisu(cbs ? cbs(src) : src, pool, undefined, "back"), [src, pool, cbs]);
  const urls = useImageUrls(r.ids.map((id) => images[id]));
  const html = sanitizeHtml(r.html, urls, scope);
  const bgmId = /risu-ctrl="bgm___auto___nvimg:([a-z0-9]+)"/i.exec(r.html)?.[1];
  const bgmUrl = bgmId ? urls[bgmId] : undefined;
  useEffect(() => {
    if (bgmUrl) playBgm(bgmUrl);
  }, [bgmUrl]);
  if (!html.trim()) return null;
  return <div className="risu-bg" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** 가장 최근 AI 메시지에 나온 감정 이미지 (없으면 그 이전 것) */
export function EmotionPanel({ messages, pool, cbsFor }: { messages: Message[]; pool: ImagePool; cbsFor: (id: string) => ((s: string) => string) | undefined }) {
  const name = useMemo(() => {
    if (!pool.emotionPanel) return null;
    for (let i = messages.length - 1, n = 0; i >= 0 && n < 6; i--) {
      const m = messages[i];
      if (m.role !== "assistant") continue;
      n++;
      const e = renderRisu(m.text, pool, cbsFor(m.id)).emotions;
      if (e.length) return e[e.length - 1];
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, pool]);
  const meta = name ? pool.emotions.find((m) => m.name === name) ?? pool.assets.find((m) => m.name === name) : undefined;
  const urls = useImageUrls(meta ? [meta] : []);
  if (!pool.emotionPanel) return null;
  const url = meta ? urls[meta.id] : undefined;
  return (
    <aside className="risu-emotion hidden w-56 shrink-0 flex-col items-center justify-end gap-2 border-l border-stone-200 p-3 lg:flex dark:border-stone-800" aria-label="감정 이미지">
      {url ? <img src={url} alt={name ?? ""} className="max-h-[70vh] w-full rounded-xl object-contain" /> : <div className="hint text-xs">감정 이미지가 여기 나옵니다</div>}
      {name && <div className="hint text-xs">{name}</div>}
    </aside>
  );
}

export function BgmButton() {
  const { playing, muted } = useBgm();
  if (!playing) return null;
  return (
    <span className="flex items-center">
      <button className="btn-ghost px-2 text-xs" onClick={toggleBgmMute} title={muted ? "배경 음악 켜기" : "배경 음악 끄기"}>{muted ? "🔇" : "🎵"}</button>
      <button className="btn-ghost px-1 text-xs" onClick={stopBgm} title="배경 음악 멈춤">⏹</button>
    </span>
  );
}
