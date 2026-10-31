import { useSyncExternalStore } from "react";

/** 앱 설치·오프라인 상태 (서비스 워커는 https 로 연 경우에만 — 내려받은 HTML 파일(file://)에서는 비활성) */
interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
interface PwaState {
  canInstall: boolean;
  installed: boolean;
  online: boolean;
  swActive: boolean;
}
let st: PwaState = { canInstall: false, installed: false, online: typeof navigator === "undefined" ? true : navigator.onLine !== false, swActive: false };
let deferred: InstallEvent | null = null;
const subs = new Set<() => void>();
const set = (p: Partial<PwaState>) => {
  st = { ...st, ...p };
  subs.forEach((f) => f());
};
export const usePwa = () => useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => st);

export const isStandalone = () => typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
export const isIOS = () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
export const canUseServiceWorker = () => typeof navigator !== "undefined" && "serviceWorker" in navigator && /^https:$|^http:$/.test(location.protocol) && (location.protocol === "https:" || /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) && !import.meta.env.DEV;

export function setupPwa() {
  if (typeof window === "undefined") return;
  set({ installed: isStandalone() });
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    set({ canInstall: true });
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    set({ canInstall: false, installed: true });
  });
  window.addEventListener("online", () => set({ online: true }));
  window.addEventListener("offline", () => set({ online: false }));
  if (canUseServiceWorker())
    navigator.serviceWorker
      .register("./sw.js", { scope: "./" })
      .then(() => set({ swActive: true }))
      .catch(() => {});
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  set({ canInstall: false });
  return outcome === "accepted";
}
