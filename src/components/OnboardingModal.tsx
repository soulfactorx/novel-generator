import { useEffect, useId, useMemo, useRef, useState } from "react";
import { renderRisu, sanitizeHtml } from "../lib/images";
import { useImageUrls } from "../lib/imageUrls";
import { completeOnboarding, displayCbs, onboardingFor, poolFor, useApp } from "../lib/store";
import type { Onboarding, Room } from "../lib/types";
import Dialog from "./Dialog";

const VAR_NAME = "risu-change-var-name";
const VAR_VALUE = "risu-change-var-value";
const optValue = (o: { label: string; value: string }) => (o.value !== "" ? o.value : o.label);
const multi = (v?: string): string[] => {
  if (!v) return [];
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p.map(String) : [v];
  } catch {
    return [v];
  }
};

/**
 * RisuAI 온보딩: 채팅을 시작하기 전에 봇이 묻는 설정 (질문 양식 또는 HTML).
 * 고른 값은 '완료'를 누를 때 이야기 변수에 기록되고, '건너뛰기'는 아무것도 바꾸지 않는다.
 */
export default function OnboardingModal({ room, onClose }: { room: Room; onClose: () => void }) {
  const found = onboardingFor(room);
  const ob = found?.onboarding as Onboarding | undefined;
  const initial = useMemo(() => {
    const a: Record<string, string> = {};
    for (const [k, v] of Object.entries(room.vars ?? {})) a[k] = v;
    return a;
  }, [room.vars]);
  const [answers, setAnswers] = useState<Record<string, string>>(initial);
  const [error, setError] = useState(false);
  if (!ob) return null;
  const questions = ob.questions.filter((q) => q.varName);
  const set = (k: string, v: string) => setAnswers((a) => ({ ...a, [k]: v }));
  const missing = ob.mode === "form" && questions.some((q) => q.required && !(q.type === "multiple" ? multi(answers[q.varName]).length : (answers[q.varName] ?? "").trim()));
  const done = () => {
    if (missing) return setError(true);
    // 질문 양식은 질문에 해당하는 변수만, HTML은 고른 값 전부
    const out = ob.mode === "form" ? Object.fromEntries(questions.filter((q) => answers[q.varName] !== undefined).map((q) => [q.varName, answers[q.varName]])) : answers;
    completeOnboarding(room.id, out);
    onClose();
  };
  return (
    <Dialog title={`🧭 ${ob.title || "시작 설정"}`} onClose={onClose} wide footer={<><button className="btn-ghost" onClick={onClose}>건너뛰기</button><button className="btn-primary" onClick={done}>완료</button></>}>
      <div className="space-y-4">
        {ob.description && <p className="whitespace-pre-wrap text-sm text-stone-600 dark:text-stone-300">{ob.description}</p>}
        {ob.mode === "html" ? (
          <HtmlOnboarding room={room} html={ob.html} answers={answers} set={set} />
        ) : (
          questions.map((q) => (
            <fieldset key={q.id} className="space-y-1.5">
              <legend className="text-sm font-bold">{q.title || q.varName}{q.required && <span className="text-rose-500"> *</span>}</legend>
              {q.description && <p className="hint">{q.description}</p>}
              {q.type === "text" ? (
                <textarea className="input min-h-16" placeholder={q.placeholder} value={answers[q.varName] ?? ""} onChange={(e) => set(q.varName, e.target.value)} aria-label={q.title} />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {q.options.map((o, i) => {
                    const v = optValue(o);
                    const on = q.type === "multiple" ? multi(answers[q.varName]).includes(v) : answers[q.varName] === v;
                    return (
                      <button key={i} type="button" className={`rounded-lg border px-3 py-1.5 text-sm ${on ? "border-violet-500 bg-violet-600 text-white" : "border-stone-300 dark:border-stone-700"}`}
                        onClick={() => {
                          if (q.type !== "multiple") return set(q.varName, v);
                          const cur = multi(answers[q.varName]);
                          set(q.varName, JSON.stringify(on ? cur.filter((x) => x !== v) : [...cur, v]));
                        }}>
                        {o.label || o.value}
                      </button>
                    );
                  })}
                </div>
              )}
            </fieldset>
          ))
        )}
        {error && missing && <p className="text-sm font-semibold text-rose-600">필수 항목(*)을 골라 주세요.</p>}
      </div>
    </Dialog>
  );
}

/** HTML 온보딩: 봇이 만든 화면. risu-change-var-name / value 가 붙은 요소를 누르거나 입력하면 값을 고름 */
function HtmlOnboarding({ room, html, answers, set }: { room: Room; html: string; answers: Record<string, string>; set: (k: string, v: string) => void }) {
  const images = useApp((s) => s.images);
  const scope = "ob" + useId().replace(/[^a-z0-9]/gi, "");
  const ref = useRef<HTMLDivElement>(null);
  const rendered = useMemo(() => renderRisu(html, poolFor(room), displayCbs(room, null)), [html, room]);
  const urls = useImageUrls(rendered.ids.map((id) => images[id]));
  const out = useMemo(() => sanitizeHtml(rendered.html, urls, scope), [rendered, urls, scope]);
  // 고른 값 표시: 같은 값이면 selected 클래스, 입력칸은 현재 값으로
  useEffect(() => {
    for (const el of ref.current?.querySelectorAll<HTMLElement>(`[${VAR_NAME}]`) ?? []) {
      const k = el.getAttribute(VAR_NAME)!;
      const cur = answers[k];
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
        if (cur === undefined) continue;
        if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) el.checked = cur === (el.getAttribute(VAR_VALUE) ?? (el.type === "checkbox" ? "1" : el.value));
        else if (document.activeElement !== el) el.value = cur;
        continue;
      }
      const on = cur !== undefined && cur === (el.getAttribute(VAR_VALUE) ?? "");
      el.classList.toggle("selected", on);
      el.classList.toggle("x-risu-selected", on);
    }
  }, [answers, out]);
  return (
    <div
      ref={ref}
      className={`risu-html ${scope}`}
      onClick={(e) => {
        const el = (e.target as Element).closest(`[${VAR_NAME}]`);
        if (!el || el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) return;
        e.preventDefault();
        set(el.getAttribute(VAR_NAME)!, el.getAttribute(VAR_VALUE) ?? "");
      }}
      onInput={(e) => {
        const el = e.target as HTMLInputElement;
        if (!el.hasAttribute?.(VAR_NAME)) return;
        const k = el.getAttribute(VAR_NAME)!;
        const fixed = el.getAttribute(VAR_VALUE);
        if (el.type === "checkbox") set(k, el.checked ? (fixed ?? "1") : "0");
        else if (el.type === "radio") el.checked && set(k, fixed ?? el.value);
        else set(k, el.value);
      }}
      onChange={(e) => {
        const el = e.target as unknown as HTMLSelectElement;
        if (el.tagName === "SELECT" && el.hasAttribute(VAR_NAME)) set(el.getAttribute(VAR_NAME)!, el.value);
      }}
      onSubmit={(e) => e.preventDefault()}
      dangerouslySetInnerHTML={{ __html: out }}
    />
  );
}
