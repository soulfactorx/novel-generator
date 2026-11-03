import { useMemo, useRef, useState } from "react";
import { download } from "../lib/backup";
import { changedPrompts, defaultPrompt, PROMPT_DEFS, type PromptDef } from "../lib/prompts";
import { updateSettings, useApp } from "../lib/store";

/** 설정 → 프롬프트: AI에게 보내는 모든 문구를 보고 고치고 기본값으로 되돌린다. 마지막 요청도 확인 */
export default function PromptsTab() {
  const prompts = useApp((x) => x.settings.prompts);
  const last = useApp((x) => x.lastRequest);
  const [q, setQ] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [msg, setMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const changed = changedPrompts(prompts);
  const nChanged = Object.keys(changed).length;

  const set = (id: string, v: string) => {
    const next = { ...prompts };
    if (v === defaultPrompt(id)) delete next[id];
    else next[id] = v;
    updateSettings({ prompts: next });
  };
  const groups = useMemo(() => {
    const k = q.trim().toLowerCase();
    const list = PROMPT_DEFS.filter((p) => (!onlyChanged || p.id in changed) && (!k || [p.id, p.label, p.group, p.hint ?? "", prompts[p.id] ?? p.text].some((t) => t.toLowerCase().includes(k))));
    const out = new Map<string, PromptDef[]>();
    for (const p of list) out.set(p.group, [...(out.get(p.group) ?? []), p]);
    return [...out];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, onlyChanged, prompts]);

  const importFile = async (f: File) => {
    try {
      const data = JSON.parse(await f.text()) as { prompts?: Record<string, string> };
      const map = changedPrompts(data.prompts ?? (data as Record<string, string>));
      updateSettings({ prompts: { ...prompts, ...map } });
      setMsg(`✅ 프롬프트 ${Object.keys(map).length}개를 가져왔습니다.`);
    } catch {
      setMsg("⚠️ 프롬프트 파일을 읽지 못했습니다.");
    }
  };

  return (
    <div className="space-y-4">
      <p className="hint">
        AI에게 보내는 문구는 모두 여기 있습니다. 고치면 바로 다음 요청부터 쓰입니다. <code>{"${이름}"}</code> 자리에는 실행할 때 내용이 들어가고, 한 줄 전체가 <code>{"${이름}"}</code>인데 내용이 없으면 그 줄은 빠집니다. 바꾼 문구는 설정과 함께 백업·동기화됩니다.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-60 flex-1 text-sm" placeholder="찾기 (이름·내용)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="프롬프트 찾기" />
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> 바꾼 것만 ({nChanged})</label>
        <span className="flex-1" />
        <button className="btn-ghost text-xs" disabled={!nChanged} onClick={() => download(`novel-generator-prompts-${new Date().toISOString().slice(0, 10)}.json`, { type: "novel-generator-prompts", prompts: changed })}>내보내기</button>
        <button className="btn-ghost text-xs" onClick={() => fileRef.current?.click()}>가져오기</button>
        <button className="btn-ghost text-xs text-rose-600" disabled={!nChanged} onClick={() => confirm(`바꾼 프롬프트 ${nChanged}개를 모두 기본값으로 되돌릴까요?`) && updateSettings({ prompts: {} })}>모두 기본값으로</button>
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ""; }} />
      </div>
      {msg && <p className="text-sm">{msg}</p>}

      <details className="card">
        <summary className="cursor-pointer font-bold">🔍 마지막으로 AI에게 보낸 요청 {last ? <span className="hint font-normal">({KIND[last.kind] ?? last.kind} · {new Date(last.at).toLocaleTimeString("ko-KR")})</span> : <span className="hint font-normal">(아직 없음)</span>}</summary>
        {last ? (
          <div className="mt-3 space-y-3 text-xs">
            <div>
              <div className="mb-1 flex items-center gap-2 font-bold">시스템 프롬프트 <span className="hint font-normal">{last.system.length.toLocaleString()}자</span><button className="btn-ghost px-2 py-0.5 text-xs" onClick={() => void navigator.clipboard?.writeText(last.system)}>복사</button></div>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-stone-100 p-2 dark:bg-stone-800">{last.system}</pre>
            </div>
            {last.messages.map((m, i) => (
              <div key={i}>
                <div className="mb-1 font-bold">{m.role === "user" ? "사용자" : m.role === "assistant" ? "AI" : m.role} <span className="hint font-normal">{m.content.length.toLocaleString()}자</span></div>
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-stone-100 p-2 dark:bg-stone-800">{m.content}</pre>
              </div>
            ))}
          </div>
        ) : (
          <p className="hint mt-2">이야기를 진행하거나 소설을 쓰면 여기에서 실제로 보낸 내용(봇 설정·로어북·Lua 편집이 반영된 최종본)을 볼 수 있습니다.</p>
        )}
      </details>

      {groups.map(([group, list]) => (
        <details key={group} className="card" open={!!q.trim() || onlyChanged}>
          <summary className="cursor-pointer font-bold">{group} <span className="hint font-normal">({list.length}{list.some((p) => p.id in changed) ? ` · 바꿈 ${list.filter((p) => p.id in changed).length}` : ""})</span></summary>
          <div className="mt-3 space-y-4">
            {list.map((p) => (
              <PromptField key={p.id} def={p} value={prompts[p.id] ?? p.text} changed={p.id in changed} onChange={(v) => set(p.id, v)} />
            ))}
          </div>
        </details>
      ))}
      {!groups.length && <p className="hint">찾는 프롬프트가 없습니다.</p>}
    </div>
  );
}

const KIND: Record<string, string> = { chat: "이야기", memory: "장기 기억", outline: "개요", episode: "회차 집필", diagnose: "진단", cover: "표지", test: "연결 확인" };

function PromptField({ def, value, changed, onChange }: { def: PromptDef; value: string; changed: boolean; onChange: (v: string) => void }) {
  const rows = Math.min(18, Math.max(2, value.split("\n").length + 1));
  const missing = (def.vars ?? []).filter((v) => !value.includes("${" + v + "}"));
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">{def.label}</span>
        {changed && <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">바꿈</span>}
        <code className="hint text-[11px]">{def.id}</code>
        <span className="flex-1" />
        {changed && <button className="btn-ghost px-2 py-0.5 text-xs" onClick={() => onChange(def.text)}>기본값으로</button>}
      </div>
      {def.hint && <p className="hint text-xs">{def.hint}</p>}
      {!!def.vars?.length && (
        <p className="text-xs text-stone-500">
          쓸 수 있는 자리: {def.vars.map((v) => <code key={v} className={`mr-1 rounded px-1 ${missing.includes(v) ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" : "bg-stone-100 dark:bg-stone-800"}`} title={missing.includes(v) ? "이 문구에 빠져 있어 이 내용은 AI에게 전달되지 않습니다" : undefined}>{"${" + v + "}"}</code>)}
        </p>
      )}
      <textarea className="input font-mono text-xs" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} aria-label={def.label} spellCheck={false} />
    </div>
  );
}
