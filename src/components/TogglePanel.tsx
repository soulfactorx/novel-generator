import type { Toggle } from "../lib/cbs";
import { setGlobal, useApp } from "../lib/store";

/** RisuAI 사이드바 토글 (값은 전역 변수 toggle_키에 저장: 고르기=선택지 번호, 켜고 끄기=1/0) */
export default function TogglePanel({ groups }: { groups: { owner: string; toggles: Toggle[] }[] }) {
  const globals = useApp((s) => s.globals);
  const val = (k: string) => {
    const v = globals[`toggle_${k}`];
    return v === undefined || v === "null" ? "" : v;
  };
  const render = (list: Toggle[], depth = 0) =>
    list.map((t, i) => {
      if (t.type === "group")
        return (
          <details key={i} open={depth === 0} className="rounded-lg border border-stone-200 px-3 py-1 dark:border-stone-800">
            <summary className="cursor-pointer py-1 text-sm font-semibold">{t.label}</summary>
            <div className="space-y-2 pb-2">{render(t.children, depth + 1)}</div>
          </details>
        );
      if (t.type === "divider") return <div key={i} className="mt-2 border-b border-stone-200 pb-1 text-xs font-bold text-stone-500 dark:border-stone-800">{t.label}</div>;
      if (t.type === "caption") return <p key={i} className="hint -mt-1">{t.label}</p>;
      if (t.type === "select")
        return (
          <label key={i} className="flex items-center justify-between gap-2 text-sm">
            <span>{t.label}</span>
            <select className="input w-40 py-1" value={val(t.key)} onChange={(e) => setGlobal(`toggle_${t.key}`, e.target.value)} aria-label={t.label}>
              {val(t.key) === "" && <option value="">(기본)</option>}
              {t.options.map((o, k) => <option key={k} value={String(k)}>{o}</option>)}
            </select>
          </label>
        );
      if (t.type === "check")
        return (
          <label key={i} className="flex items-center justify-between gap-2 text-sm">
            <span>{t.label}</span>
            <input type="checkbox" checked={val(t.key) === "1"} onChange={(e) => setGlobal(`toggle_${t.key}`, e.target.checked ? "1" : "0")} aria-label={t.label} />
          </label>
        );
      return (
        <label key={i} className="block text-sm">
          <span>{t.label}</span>
          {t.type === "textarea" ? (
            <textarea className="input mt-1 min-h-16" defaultValue={val(t.key)} onBlur={(e) => setGlobal(`toggle_${t.key}`, e.target.value)} aria-label={t.label} />
          ) : (
            <input className="input mt-1" defaultValue={val(t.key)} onBlur={(e) => setGlobal(`toggle_${t.key}`, e.target.value)} aria-label={t.label} />
          )}
        </label>
      );
    });
  if (!groups.length) return null;
  return (
    <div className="space-y-3">
      {groups.map((g, i) => (
        <div key={i} className="space-y-2">
          {groups.length > 1 && <div className="text-xs font-bold text-violet-600">{g.owner}</div>}
          {render(g.toggles)}
        </div>
      ))}
      <p className="hint">봇이 정한 설정입니다(RisuAI 토글). 바꾸면 인사말·설정·화면이 바로 바뀌고, 다음 응답부터 AI에게도 반영됩니다. 같은 봇을 쓰는 모든 이야기에 함께 적용됩니다.</p>
    </div>
  );
}
