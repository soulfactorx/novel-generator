/**
 * 모듈 붙이기 (RisuAI 모듈처럼): 라이브러리의 세계관·RisuAI 모듈(.risum)을 등장인물이나 이야기에 여러 개 붙인다.
 * 붙인 모듈의 그림·로어북·정규식 스크립트·트리거(Lua)·토글·배경 화면이 봇과 함께 동작한다. 이야기의 세계관 자리는 그대로.
 */
import { useRef, useState } from "react";
import { parseRisuFile } from "../lib/risu";
import { entitiesOf, existingPackages, importRisu, useApp } from "../lib/store";
import type { World } from "../lib/types";

/** 모듈 한 줄 요약: 그림 · 로어 · 스크립트 · Lua */
export function useModuleSummary() {
  const images = useApp((s) => s.images);
  return (m: World) => {
    const n = Object.values(images).filter((x) => x.ownerId === m.id).length;
    const lua = (m.risu?.triggers ?? []).some((t) => ((t as { effect?: { type?: string }[] }).effect ?? []).some((e) => e?.type === "triggerlua"));
    return [n && `그림 ${n}`, m.lore.length && `로어 ${m.lore.length}`, m.scripts?.length && `스크립트 ${m.scripts.length}`, lua && "Lua", m.risu?.backgroundHTML && "배경"].filter(Boolean).join(" · ") || "내용 없음";
  };
}

/** 붙일 모듈 고르기 + .risum 바로 가져와 붙이기 */
function AddModule({ exclude, onAdd }: { exclude: string[]; onAdd: (id: string) => void }) {
  const lib = useApp((s) => s.library);
  const choices = entitiesOf(lib, "world").filter((w) => !exclude.includes(w.id));
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState("");
  const importFile = async (f: File) => {
    setMsg("가져오는 중…");
    try {
      const data = await parseRisuFile(f.name, new Uint8Array(await f.arrayBuffer()));
      const incoming = data.library.find((e) => e.kind === "world");
      if (!incoming) {
        setMsg("⚠️ 모듈(.risum)이 아닙니다. 캐릭터 카드는 [설정 → 데이터]에서 가져오세요.");
        return;
      }
      // 같은 모듈을 이미 가져왔으면 그것을 새 내용으로 교체하고 붙인다 (중복 방지)
      const same = existingPackages(data).find((p) => p.incoming === incoming.id);
      await importRisu(data, { replace: true });
      onAdd(same?.existing.id ?? incoming.id);
      setMsg(`✅ '${incoming.name}' 모듈을 붙였습니다${data.images.length ? ` (그림 ${data.images.length}장)` : ""}.`);
    } catch (e) {
      setMsg(`⚠️ ${(e as Error).message}`);
    }
  };
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto max-w-full flex-1 py-1 text-sm" value="" onChange={(e) => e.target.value && onAdd(e.target.value)} aria-label="붙일 모듈">
          <option value="">+ 라이브러리에서 모듈 붙이기…</option>
          {choices.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <button className="btn-ghost border border-stone-300 px-2 py-1 text-xs dark:border-stone-700" onClick={() => fileRef.current?.click()}>⬆ .risum 가져와 붙이기</button>
        <input ref={fileRef} type="file" accept=".risum,.json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ""; }} />
      </div>
      {msg && <p className="text-xs">{msg}</p>}
    </div>
  );
}

/** 등장인물에 붙인 모듈 (이 인물이 나오는 모든 이야기에 적용) */
export function CharacterModules({ ids, selfWorldId, onChange }: { ids: string[]; selfWorldId?: string; onChange: (ids: string[]) => void }) {
  const lib = useApp((s) => s.library);
  const summary = useModuleSummary();
  const list = ids.map((id) => lib[id]).filter((m): m is World => m?.kind === "world");
  return (
    <div className="space-y-2">
      <span className="label mb-0">🧩 모듈 ({list.length})</span>
      <p className="hint">RisuAI 모듈(.risum)이나 라이브러리의 세계관을 이 인물에 붙입니다. 붙인 모듈의 그림·로어북·스크립트·트리거·배경이 이 인물이 나오는 모든 이야기에서 함께 동작합니다. 이야기마다 [📝 설정]에서 끌 수 있습니다.</p>
      {list.map((m) => (
        <div key={m.id} className="flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm dark:border-stone-800">
          <span className="min-w-0 flex-1"><span className="font-semibold">{m.name}</span> <span className="hint">{summary(m)}</span></span>
          <button className="btn-ghost px-2 py-0.5 text-xs text-rose-600" onClick={() => onChange(ids.filter((x) => x !== m.id))} aria-label={`${m.name} 떼기`}>떼기</button>
        </div>
      ))}
      <AddModule exclude={[...ids, ...(selfWorldId ? [selfWorldId] : [])]} onAdd={(id) => onChange([...new Set([...ids, id])])} />
    </div>
  );
}

/** 이야기의 모듈: 등장인물에 붙은 것 켜기·끄기 + 이 이야기에만 붙이기 */
export function RoomModules({ characterIds, worldId, moduleIds, offModules, onChange }: { characterIds: string[]; worldId?: string; moduleIds: string[]; offModules: string[]; onChange: (p: { moduleIds: string[]; offModules: string[] }) => void }) {
  const lib = useApp((s) => s.library);
  const summary = useModuleSummary();
  const fromChars = [...new Set(characterIds.flatMap((id) => (lib[id]?.kind === "character" ? lib[id].moduleIds ?? [] : [])))].filter((id) => id !== worldId);
  const own = moduleIds.filter((id) => !fromChars.includes(id) && id !== worldId);
  const row = (id: string, control: React.ReactNode, note?: string) => {
    const m = lib[id];
    if (m?.kind !== "world") return null;
    return (
      <div key={id} className="flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm dark:border-stone-800">
        <span className="min-w-0 flex-1"><span className="font-semibold">{m.name}</span> <span className="hint">{summary(m)}{note ? ` · ${note}` : ""}</span></span>
        {control}
      </div>
    );
  };
  return (
    <div className="space-y-2">
      <span className="label mb-0">🧩 모듈</span>
      <p className="hint">세계관과 따로, 그림·로어북·스크립트·트리거를 더하는 모듈입니다(RisuAI 모듈처럼 여러 개).</p>
      {fromChars.map((id) =>
        row(
          id,
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!offModules.includes(id)} onChange={(e) => onChange({ moduleIds, offModules: e.target.checked ? offModules.filter((x) => x !== id) : [...offModules, id] })} /> 사용</label>,
          "등장인물에 붙은 모듈",
        ),
      )}
      {own.map((id) => row(id, <button className="btn-ghost px-2 py-0.5 text-xs text-rose-600" onClick={() => onChange({ moduleIds: moduleIds.filter((x) => x !== id), offModules })}>떼기</button>, "이 이야기에만"))}
      <AddModule exclude={[...fromChars, ...own, ...(worldId ? [worldId] : [])]} onAdd={(id) => onChange({ moduleIds: [...new Set([...moduleIds, id])], offModules: offModules.filter((x) => x !== id) })} />
    </div>
  );
}
