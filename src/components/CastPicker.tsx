import { entitiesOf, useApp } from "../lib/store";

export interface Cast {
  worldId?: string;
  characterIds: string[];
  personaId?: string;
}

/** 이야기방의 세계관 · 등장인물 · 주인공 선택 */
export default function CastPicker({ value, onChange, onOpenLibrary }: { value: Cast; onChange: (c: Cast) => void; onOpenLibrary?: () => void }) {
  const lib = useApp((s) => s.library);
  const worlds = entitiesOf(lib, "world");
  const chars = entitiesOf(lib, "character");
  const personas = entitiesOf(lib, "persona");
  // 선택한 세계관 소속 인물을 위로
  const sorted = [...chars].sort((a, b) => Number(b.worldId === value.worldId && !!value.worldId) - Number(a.worldId === value.worldId && !!value.worldId));
  const toggle = (id: string) => onChange({ ...value, characterIds: value.characterIds.includes(id) ? value.characterIds.filter((x) => x !== id) : [...value.characterIds, id] });
  const setWorld = (worldId?: string) => {
    // 세계관을 처음 고를 때 소속 인물을 자동 선택
    const auto = worldId && !value.characterIds.length ? chars.filter((c) => c.worldId === worldId).map((c) => c.id) : value.characterIds;
    onChange({ ...value, worldId, characterIds: auto });
  };
  if (!worlds.length && !chars.length && !personas.length)
    return (
      <div className="hint rounded-lg border border-dashed border-stone-300 p-3 dark:border-stone-700">
        라이브러리가 비어 있습니다. 세계관·등장인물을 만들어 두면 여러 이야기에서 재사용할 수 있습니다.
        {onOpenLibrary && <button className="btn-ghost ml-1 px-2 py-0.5 text-xs" onClick={onOpenLibrary}>📚 라이브러리 열기</button>}
      </div>
    );
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <span className="label">🌍 세계관</span>
          <select className="input" value={value.worldId ?? ""} onChange={(e) => setWorld(e.target.value || undefined)} aria-label="세계관 선택">
            <option value="">없음</option>
            {worlds.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div>
          <span className="label">🙋 주인공 (내가 연기)</span>
          <select className="input" value={value.personaId ?? ""} onChange={(e) => onChange({ ...value, personaId: e.target.value || undefined })} aria-label="주인공 선택">
            <option value="">지정 안 함</option>
            {personas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      {chars.length > 0 && (
        <div>
          <span className="label">🎭 등장인물 ({value.characterIds.length}명 선택)</span>
          <div className="flex flex-wrap gap-1.5">
            {sorted.map((c) => {
              const on = value.characterIds.includes(c.id);
              return (
                <button key={c.id} className={`rounded-full border px-3 py-1 text-sm ${on ? "border-violet-500 bg-violet-600 text-white" : "border-stone-300 dark:border-stone-700"}`} onClick={() => toggle(c.id)} title={c.summary} aria-pressed={on}>
                  {on ? "✓ " : ""}{c.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {onOpenLibrary && <button className="btn-ghost px-2 py-1 text-xs" onClick={onOpenLibrary}>📚 라이브러리에서 편집</button>}
    </div>
  );
}
