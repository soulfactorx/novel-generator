import { useState } from "react";
import { uid } from "../lib/id";
import { parseKeys } from "../lib/lore";
import type { LoreEntry } from "../lib/types";

/** 로어북 항목 목록 편집 */
export default function LoreEditor({ entries, onChange }: { entries: LoreEntry[]; onChange: (e: LoreEntry[]) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const set = (id: string, patch: Partial<LoreEntry>) => onChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const add = () => {
    const e: LoreEntry = { id: uid("l"), title: "", keys: [], content: "", enabled: true };
    onChange([...entries, e]);
    setOpen(e.id);
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="label mb-0">로어북 ({entries.length})</span>
        <button className="btn-ghost px-2 py-1 text-xs" onClick={add}>+ 항목 추가</button>
      </div>
      <p className="hint">키워드가 최근 대화에 나올 때만 AI에게 전달되는 설정 카드입니다. 장소·조직·물건·과거 사건처럼 가끔 필요한 정보를 넣으면 비용을 아끼면서 설정을 지킬 수 있습니다.</p>
      {entries.map((e) => (
        <div key={e.id} className={`rounded-lg border border-stone-200 dark:border-stone-800 ${e.enabled ? "" : "opacity-60"}`}>
          <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm" onClick={() => setOpen(open === e.id ? null : e.id)}>
            <span className="font-semibold">{e.title || "(제목 없음)"}</span>
            <span className="truncate text-xs text-stone-500">{e.always ? "항상 전달" : e.keys.join(", ") || "키워드 없음"}</span>
            <span className="ml-auto text-xs text-stone-400">{open === e.id ? "▲" : "▼"}</span>
          </button>
          {open === e.id && (
            <div className="space-y-2 border-t border-stone-200 p-3 dark:border-stone-800">
              <input className="input" placeholder="제목 (예: 은빛 항구 조합)" value={e.title} onChange={(x) => set(e.id, { title: x.target.value })} aria-label="로어 제목" />
              <KeysInput keys={e.keys} onChange={(keys) => set(e.id, { keys })} />
              <textarea className="input min-h-24" placeholder="내용 (짧고 사실 위주로)" value={e.content} onChange={(x) => set(e.id, { content: x.target.value })} aria-label="로어 내용" />
              <details className="rounded border border-stone-200 px-2 py-1 text-sm dark:border-stone-800" open={!!(e.secondKeys?.length || e.regex || e.decorators || e.order)}>
                <summary className="cursor-pointer text-xs font-semibold text-stone-500">고급 (RisuAI 규칙)</summary>
                <div className="mt-2 space-y-2">
                  <label className="block"><span className="label">보조 키 (주 키와 함께 이것도 나와야 전달, 쉼표로 구분)</span><input className="input" defaultValue={(e.secondKeys ?? []).join(", ")} onBlur={(x) => set(e.id, { secondKeys: parseKeys(x.target.value) })} aria-label="보조 키" /></label>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!e.regex} onChange={(x) => set(e.id, { regex: x.target.checked })} /> 키를 정규식으로 (/패턴/플래그)</label>
                    <label className="flex items-center gap-1.5">우선순위 <input type="number" className="input w-20 py-1" value={e.order ?? 0} onChange={(x) => set(e.id, { order: Number(x.target.value) || 0 })} aria-label="우선순위" /></label>
                  </div>
                  <label className="block"><span className="label">데코레이터 (한 줄에 하나: @@activate_only_after 3 · @@probability 50 · @@exclude_keys 키 · @@additional_keys 키 · @@activate · @@dont_activate · @@scan_depth 2 · @@unrecursive)</span><textarea className="input min-h-14 font-mono text-xs" value={e.decorators ?? ""} onChange={(x) => set(e.id, { decorators: x.target.value })} aria-label="데코레이터" /></label>
                </div>
              </details>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={e.enabled} onChange={(x) => set(e.id, { enabled: x.target.checked })} /> 사용</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!e.always} onChange={(x) => set(e.id, { always: x.target.checked })} /> 키워드와 상관없이 항상 전달</label>
                <button className="btn-danger ml-auto px-2 py-1 text-xs" onClick={() => onChange(entries.filter((y) => y.id !== e.id))}>삭제</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** 쉼표로 구분된 키워드 입력 (입력 중에는 원문 유지, 벗어날 때 정리) */
function KeysInput({ keys, onChange }: { keys: string[]; onChange: (k: string[]) => void }) {
  const [text, setText] = useState(keys.join(", "));
  return <input className="input" placeholder="키워드 (쉼표로 구분: 조합, 항구 조합, 길드)" value={text} onChange={(e) => { setText(e.target.value); onChange(parseKeys(e.target.value)); }} onBlur={() => setText(keys.join(", "))} aria-label="로어 키워드" />;
}
