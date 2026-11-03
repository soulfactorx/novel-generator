import { useEffect, useRef, type ReactNode } from "react";

/** 열린 창 순서 — Esc 는 맨 위 창만 닫는다 */
const stack: object[] = [];

/**
 * 공통 창. 제목 줄·tabs(제목 아래 고정 영역)·footer(아래 고정)는 스크롤해도 그대로 있고 본문만 스크롤된다.
 * size: md(기본) · lg(wide) · xl(라이브러리처럼 큰 창, 화면 높이 고정)
 * scroll=false 이면 본문 스크롤을 자식이 직접 맡는다 (두 칸이 따로 스크롤되는 화면 등)
 */
export default function Dialog({ title, onClose, children, footer, wide, size, tabs, scroll = true }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; size?: "md" | "lg" | "xl"; tabs?: ReactNode; scroll?: boolean }) {
  const sz = size ?? (wide ? "lg" : "md");
  const me = useRef({});
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const self = me.current;
    stack.push(self);
    // Esc 로 닫기 (맨 위 창만, 한글 조합 중이거나 다른 곳에서 처리했으면 무시)
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !e.isComposing && stack[stack.length - 1] === self) close.current();
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      stack.splice(stack.indexOf(self), 1);
    };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className={`flex w-full flex-col overflow-hidden rounded-t-2xl bg-stone-50 shadow-2xl sm:rounded-2xl dark:bg-stone-950 ${sz === "xl" ? "h-[94vh] sm:h-[90vh] sm:max-w-6xl" : sz === "lg" ? "max-h-[92vh] sm:max-w-3xl" : "max-h-[92vh] sm:max-w-lg"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-stone-200 px-4 py-3 dark:border-stone-800">
          <h2 className="font-bold">{title}</h2>
          <button className="btn-ghost px-2" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        {tabs && <div className="shrink-0 border-b border-stone-200 px-4 py-2 dark:border-stone-800">{tabs}</div>}
        <div className={scroll ? "min-h-0 flex-1 overflow-y-auto p-4" : "flex min-h-0 flex-1 flex-col"}>{children}</div>
        {footer && <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-stone-200 px-4 py-3 dark:border-stone-800">{footer}</div>}
      </div>
    </div>
  );
}
