import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** 가장 가까운 세로 스크롤 상자 */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/**
 * AI가 글을 쓰는 동안 화면이 끝을 따라가되, 사용자가 위로 스크롤하면 따라가기를 멈춘다.
 * 다시 맨 아래(근처)로 내리거나 jump()를 부르면 다시 따라간다.
 * - follow(): 따라가는 중일 때만 맨 아래로
 * - jump(): 무조건 맨 아래로 + 다시 따라가기
 * - away: 따라가기를 멈춘 상태 (↓ 최신 글로 버튼 표시용)
 */
export function useFollowScroll(endRef: RefObject<HTMLElement | null>, near = 80) {
  const stuck = useRef(true);
  const [away, setAway] = useState(false);
  const box = useRef<HTMLElement | null>(null);
  const lastTop = useRef(0); // 우리가 마지막으로 내린 위치

  useEffect(() => {
    const unstick = () => {
      if (!stuck.current) return;
      stuck.current = false;
      setAway(true);
    };
    const onScroll = () => {
      const el = box.current;
      if (!el) return;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= near;
      if (atBottom) {
        if (!stuck.current) {
          stuck.current = true;
          setAway(false);
        }
      } else if (el.scrollTop < lastTop.current - 4) unstick(); // 사용자가 위로 올림 (글이 늘어나는 것만으로는 위치가 줄지 않음)
      lastTop.current = el.scrollTop;
    };
    const onWheel = (e: WheelEvent) => e.deltaY < 0 && unstick();
    const onKey = (e: KeyboardEvent) => ["ArrowUp", "PageUp", "Home"].includes(e.key) && unstick();
    let touchY = 0;
    const onTouchStart = (e: TouchEvent) => (touchY = e.touches[0]?.clientY ?? 0);
    const onTouchMove = (e: TouchEvent) => (e.touches[0]?.clientY ?? 0) > touchY + 8 && unstick(); // 손가락을 아래로 = 위 내용 보기
    const opts = { passive: true } as const;
    const detach = (el: HTMLElement) => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
    const attach = () => {
      const el = scrollParent(endRef.current) ?? (endRef.current?.closest(".overflow-y-auto") as HTMLElement | null);
      if (!el || el === box.current) return;
      if (box.current) detach(box.current);
      box.current = el;
      lastTop.current = el.scrollTop;
      el.addEventListener("scroll", onScroll, opts);
      el.addEventListener("wheel", onWheel, opts);
      el.addEventListener("keydown", onKey);
      el.addEventListener("touchstart", onTouchStart, opts);
      el.addEventListener("touchmove", onTouchMove, opts);
    };
    attach();
    const t = setInterval(attach, 1000); // 화면이 바뀌어 스크롤 상자가 새로 생긴 경우
    return () => {
      clearInterval(t);
      if (box.current) detach(box.current);
      box.current = null;
    };
  }, [endRef, near]);

  const toEnd = () => {
    const el = box.current ?? scrollParent(endRef.current);
    if (el) {
      el.scrollTop = el.scrollHeight;
      lastTop.current = el.scrollTop;
    } else void endRef.current?.scrollIntoView?.({ block: "end" });
  };
  const follow = useCallback(() => {
    if (stuck.current) toEnd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const jump = useCallback(() => {
    stuck.current = true;
    setAway(false);
    toEnd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { follow, jump, away };
}
