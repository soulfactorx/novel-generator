/**
 * 배경 음악 ({{bgm::이름}}): 하나만 반복 재생. 나중에 나온 메시지의 음악이 이전 것을 바꾼다.
 * 브라우저가 자동 재생을 막으면 사용자가 화면을 한 번 누른 뒤 재생된다.
 */
import { useSyncExternalStore } from "react";

let audio: HTMLAudioElement | null = null;
let current = "";
let muted = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function playBgm(url: string) {
  if (typeof Audio === "undefined" || !url || url === current) return;
  current = url;
  audio?.pause();
  audio = new Audio(url);
  audio.loop = true;
  audio.volume = 0.5;
  if (!muted) {
    void audio.play().catch(() => {
      // 자동 재생이 막힘 → 첫 클릭 때 재생
      const resume = () => {
        if (!muted && audio && current === url) void audio.play().catch(() => {});
        document.removeEventListener("pointerdown", resume);
      };
      document.addEventListener("pointerdown", resume, { once: true });
    });
  }
  emit();
}
export function stopBgm() {
  audio?.pause();
  audio = null;
  current = "";
  emit();
}
export function toggleBgmMute() {
  muted = !muted;
  if (audio) muted ? audio.pause() : void audio.play().catch(() => {});
  emit();
}
export function useBgm(): { playing: boolean; muted: boolean } {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => (current ? (muted ? "m" : "p") : ""),
  ) === "p"
    ? { playing: true, muted: false }
    : current
      ? { playing: true, muted: true }
      : { playing: false, muted: false };
}
