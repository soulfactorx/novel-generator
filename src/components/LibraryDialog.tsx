import { useState, type ReactNode } from "react";
import { downloadBlob, safeFileName } from "../lib/exporters";
import { characterToCard, characterToCharx, worldToModule, writeRisum, type ExportImage } from "../lib/risu";
import { createEntity, createNovel, createRoom, deleteEntity, entitiesOf, getState, loadImageData, updateEntity, useApp } from "../lib/store";
import type { Character, Entity, EntityKind, Persona, World } from "../lib/types";
import Dialog from "./Dialog";
import { useImageUrls } from "../lib/imageUrls";
import LoreEditor from "./LoreEditor";
import { CreatorNotes, GreetingsEditor, ImageGallery, PackageBadge, PackageToggles, RisuSettings } from "./ImageGallery";

const KINDS: [EntityKind, string, string][] = [
  ["world", "세계관", "🌍"],
  ["character", "등장인물", "🎭"],
  ["persona", "주인공", "🙋"],
];

export default function LibraryDialog({ initialKind = "world", onClose }: { initialKind?: EntityKind; onClose: () => void }) {
  const lib = useApp((s) => s.library);
  const rooms = useApp((s) => s.rooms);
  const images = useApp((s) => s.images);
  const [kind, setKind] = useState<EntityKind>(initialKind);
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const list = (entitiesOf(lib, kind) as Entity[]).filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase()));
  const cur = sel ? lib[sel] : undefined;
  const usedBy = (id: string) => Object.values(rooms).filter((r) => r.worldId === id || r.personaId === id || r.characterIds.includes(id)).length;
  // 목록의 대표 이미지 (있으면)
  const icons = list.map((e) => Object.values(images).find((m) => m.ownerId === e.id && m.kind === "icon")).filter((m): m is NonNullable<typeof m> => !!m);
  const iconUrls = useImageUrls(icons);
  const iconOf = (id: string) => icons.find((m) => m.ownerId === id);
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const sections = cur ? SECTIONS.filter(([, , kinds]) => kinds.includes(cur.kind)) : [];

  return (
    <Dialog
      title="라이브러리"
      onClose={onClose}
      size="xl"
      scroll={false}
      tabs={
        <div className="flex gap-1">
          {KINDS.map(([k, label, icon]) => (
            <button key={k} className={`btn flex-1 py-1.5 ${kind === k ? "bg-violet-600 text-white" : "bg-stone-200/70 dark:bg-stone-800"}`} onClick={() => { setKind(k); setSel(null); setQ(""); }}>
              {icon} {label} <span className="text-xs opacity-70">{entitiesOf(lib, k).length}</span>
            </button>
          ))}
        </div>
      }
      footer={
        cur && (
          <div className="flex w-full flex-wrap items-center gap-2">
            <button className="btn-ghost px-2 text-xs md:hidden" onClick={() => setSel(null)}>← 목록</button>
            <button className="btn-primary" onClick={() => { startStory(cur, lib, cur.kind === "character" ? cur.greetings?.find((g) => g.trim()) : undefined); onClose(); }} title={cur.kind === "character" && cur.greetings?.length ? "1번 인사말로 시작합니다. 다른 인사말은 인사말 목록에서 고르세요." : undefined}>✒️ 새 이야기</button>
            {cur.kind !== "persona" && <button className="btn-ghost border border-stone-300 dark:border-stone-700" onClick={() => { startNovel(cur, lib); onClose(); }}>📖 새 소설</button>}
            <RisuExport e={cur} lib={lib} />
            <button className="btn-danger ml-auto" onClick={() => { const n = usedBy(cur.id); if (confirm(`'${cur.name}'을(를) 삭제할까요?${n ? `\n이 항목을 쓰는 이야기 ${n}개에서는 연결만 해제되고 이야기는 남습니다.` : ""}`)) { deleteEntity(cur.id); setSel(null); } }}>삭제</button>
          </div>
        )
      }
    >
      <div className="grid min-h-0 flex-1 md:grid-cols-[16rem_1fr]">
        <aside className={`min-h-0 flex-col border-stone-200 md:flex md:border-r dark:border-stone-800 ${cur ? "hidden" : "flex"}`}>
          <div className="flex shrink-0 gap-2 p-3">
            <input className="input" placeholder="검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="검색" />
            <button className="btn-primary shrink-0" onClick={() => setSel(createEntity(kind))}>+ 추가</button>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
            {list.length === 0 && <p className="hint px-1 py-4">{kind === "world" ? "세계관은 이야기의 배경·규칙·로어북을 묶어 여러 이야기에서 재사용합니다." : kind === "character" ? "등장인물의 성격과 말투를 정해 두면 AI가 일관되게 연기합니다." : "주인공은 사용자가 연기하는 인물입니다. AI는 주인공의 대사를 대신 정하지 않습니다."}</p>}
            {list.map((e) => {
              const ic = iconOf(e.id);
              return (
                <button key={e.id} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left ${e.id === sel ? "bg-violet-100 dark:bg-violet-950/60" : "hover:bg-stone-200/70 dark:hover:bg-stone-800"}`} onClick={() => setSel(e.id)}>
                  {ic && iconUrls[ic.id] ? <img src={iconUrls[ic.id]} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" /> : <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-stone-200 text-lg dark:bg-stone-800">{KINDS.find(([k]) => k === e.kind)?.[2]}</span>}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{e.name || "(이름 없음)"}</span>
                    <span className="block truncate text-xs text-stone-500">{subtitle(e, lib)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>
        <section className={`min-h-0 overflow-y-auto ${cur ? "" : "hidden md:block"}`}>
          {!cur ? (
            <p className="hint grid h-full place-items-center p-10">왼쪽에서 항목을 고르거나 새로 추가하세요.</p>
          ) : (
            <>
              {/* 편집 항목 바로 가기 (위에 고정) */}
              <nav className="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-stone-200 bg-stone-50/95 px-4 py-2 backdrop-blur dark:border-stone-800 dark:bg-stone-950/95" aria-label="편집 항목">
                <span className="mr-1 max-w-[9rem] shrink-0 truncate self-center text-sm font-bold sm:max-w-[16rem]">{cur.name || "(이름 없음)"}</span>
                {sections.map(([id, label]) => (
                  <button key={id} className="btn-ghost shrink-0 px-2 py-0.5 text-xs" onClick={() => scrollTo(id)}>{label}</button>
                ))}
              </nav>
              <div className="space-y-4 p-4" key={cur.id}>
                <div id="lib-package" className="scroll-mt-14 space-y-3">
                  {cur.kind !== "persona" && <PackageBadge e={cur} />}
                  {cur.kind === "character" && <CreatorNotes c={cur} />}
                  {cur.kind !== "persona" && <PackageToggles e={cur} />}
                </div>
                {cur.kind === "world" && <WorldForm w={cur} />}
                {cur.kind === "character" && <CharacterForm c={cur} worlds={entitiesOf(lib, "world")} onStart={(g) => { startStory(cur, lib, g); onClose(); }} />}
                {cur.kind === "persona" && <PersonaForm p={cur} />}
              </div>
            </>
          )}
        </section>
      </div>
    </Dialog>
  );
}

/** 편집 화면의 항목 (바로 가기 버튼): [id, 이름, 쓰는 종류] */
const SECTIONS: [string, string, EntityKind[]][] = [
  ["lib-package", "패키지", ["world", "character"]],
  ["lib-basic", "기본 정보", ["world", "character", "persona"]],
  ["lib-greetings", "인사말", ["character"]],
  ["lib-lore", "로어북", ["world", "character"]],
  ["lib-images", "이미지", ["world", "character"]],
  ["lib-scripts", "스크립트", ["world", "character"]],
];
/** 편집 화면 한 묶음 */
function Section({ id, children }: { id: string; children: ReactNode }) {
  return <div id={id} className="scroll-mt-14 space-y-4">{children}</div>;
}

/** RisuAI에서 가져올 수 있는 파일로 내보내기 (등장인물: charx·json 카드, 세계관: risum 모듈) */
function RisuExport({ e, lib }: { e: Entity; lib: Record<string, Entity> }) {
  if (e.kind === "persona") return null;
  const name = safeFileName(e.name);
  if (e.kind === "world")
    return <button className="btn-ghost border border-stone-300 dark:border-stone-700" title="RisuAI 모듈(로어북)로 내보내기" onClick={() => downloadBlob(`${name}.risum`, writeRisum(worldToModule(e)) as BlobPart, "application/octet-stream")}>⬇ RisuAI 모듈(.risum)</button>;
  const w = e.worldId && lib[e.worldId]?.kind === "world" ? (lib[e.worldId] as World) : undefined;
  const exportCharx = async () => {
    // 패키지 전체: 이미지까지 담아 내보낸다 (다른 기기로 옮기거나 백업할 때)
    const metas = Object.values(getState().images).filter((m) => m.ownerId === e.id).sort((a, b) => a.createdAt - b.createdAt);
    const images: ExportImage[] = [];
    for (const meta of metas) {
      const bytes = await loadImageData(meta.id).catch(() => null);
      if (bytes) images.push({ meta, bytes });
    }
    downloadBlob(`${name}.charx`, characterToCharx(e, w, images) as BlobPart, "application/zip");
  };
  return (
    <>
      <button className="btn-ghost border border-stone-300 dark:border-stone-700" title={`이미지·인사말·스크립트까지 패키지 전체를 RisuAI 카드로 내보내기${w ? " (소속 세계관 포함)" : ""}. 다른 기기로 옮기거나 백업할 때 쓰세요.`} onClick={() => void exportCharx()}>⬇ 패키지(.charx)</button>
      <button className="btn-ghost border border-stone-300 dark:border-stone-700" title="Character Card V3 JSON" onClick={() => downloadBlob(`${name}.json`, JSON.stringify(characterToCard(e, w), null, 2), "application/json")}>⬇ .json</button>
    </>
  );
}

function subtitle(e: Entity, lib: Record<string, Entity>): string {
  if (e.kind === "world") return `${e.source ? "📦 · " : ""}${e.lore.length ? `로어 ${e.lore.length} · ` : ""}${e.description.slice(0, 40) || "설명 없음"}`;
  if (e.kind === "character") return [e.source && "📦", e.summary, e.worldId && lib[e.worldId]?.name].filter(Boolean).join(" · ") || "소개 없음";
  return e.profile.slice(0, 40) || "소개 없음";
}

/** 라이브러리 항목에서 바로 이야기 시작 (greeting: 첫 메시지) */
function startStory(e: Entity, lib: Record<string, Entity>, greeting?: string) {
  if (e.kind === "world") createRoom({ title: e.name, worldId: e.id, characterIds: entitiesOf(lib, "character").filter((c) => c.worldId === e.id).map((c) => c.id) });
  else if (e.kind === "character") createRoom({ title: `${e.name}와(과)의 이야기`, characterIds: [e.id], ...(e.worldId && lib[e.worldId] ? { worldId: e.worldId } : {}), greeting });
  else createRoom({ personaId: e.id });
}
/** 라이브러리 항목으로 소설 기획 시작 (기획 탭에 세계관·인물이 채워짐) */
function startNovel(e: Character | World, lib: Record<string, Entity>) {
  if (e.kind === "world") createNovel({ title: e.name, worldId: e.id, characterIds: entitiesOf(lib, "character").filter((c) => c.worldId === e.id).map((c) => c.id) });
  else createNovel({ title: e.name, characterIds: [e.id], ...(e.worldId && lib[e.worldId] ? { worldId: e.worldId } : {}) });
}

function F({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
      {hint && <p className="hint mt-1">{hint}</p>}
    </div>
  );
}

function WorldForm({ w }: { w: World }) {
  const up = (p: Partial<World>) => updateEntity<World>(w.id, p);
  return (
    <>
      <Section id="lib-basic">
      <F label="이름"><input className="input" value={w.name} onChange={(e) => up({ name: e.target.value })} aria-label="세계관 이름" /></F>
      <F label="세계관 설명" hint="시대, 장소, 분위기, 사회 구조 등 이야기 전체의 배경">
        <textarea className="input min-h-36" value={w.description} onChange={(e) => up({ description: e.target.value })} placeholder="예) 마법이 산업이 된 근대 항구 도시 '레인포트'. 비가 그치지 않고, 마력 등불이 거리를 밝힌다…" aria-label="세계관 설명" />
      </F>
      <F label="규칙 · 문체 지시" hint="AI가 반드시 지킬 것 (선택)">
        <textarea className="input min-h-20" value={w.rules} onChange={(e) => up({ rules: e.target.value })} placeholder="예) 마법에는 반드시 대가가 따른다. / 현대 외래어를 쓰지 않는다." aria-label="세계관 규칙" />
      </F>
      </Section>
      <Section id="lib-lore"><LoreEditor entries={w.lore} onChange={(lore) => up({ lore })} /></Section>
      <Section id="lib-images"><ImageGallery ownerId={w.id} /></Section>
      <Section id="lib-scripts"><RisuSettings e={w} /></Section>
    </>
  );
}

function CharacterForm({ c, worlds, onStart }: { c: Character; worlds: World[]; onStart: (greeting: string) => void }) {
  const up = (p: Partial<Character>) => updateEntity<Character>(c.id, p);
  return (
    <>
      <Section id="lib-basic">
      <div className="grid gap-3 sm:grid-cols-2">
        <F label="이름"><input className="input" value={c.name} onChange={(e) => up({ name: e.target.value })} aria-label="인물 이름" /></F>
        <F label="소속 세계관">
          <select className="input" value={c.worldId ?? ""} onChange={(e) => up({ worldId: e.target.value || undefined })} aria-label="소속 세계관">
            <option value="">없음</option>
            {worlds.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </F>
      </div>
      <F label="한 줄 소개"><input className="input" value={c.summary} onChange={(e) => up({ summary: e.target.value })} placeholder="예) 29세 · 조합 감찰관" aria-label="한 줄 소개" /></F>
      <F label="프로필" hint="외모, 성격, 배경, 다른 인물과의 관계, 숨겨진 비밀 등">
        <textarea className="input min-h-36" value={c.profile} onChange={(e) => up({ profile: e.target.value })} aria-label="프로필" />
      </F>
      <F label="말투 · 대사 예시" hint="실제 대사 2~4줄을 적으면 말투가 가장 잘 유지됩니다.">
        <textarea className="input min-h-24" value={c.speech} onChange={(e) => up({ speech: e.target.value })} placeholder={'"규정은 규정입니다. 예외는 없어요."\n"…그래도, 오늘은 못 본 걸로 하죠."'} aria-label="말투 예시" />
      </F>
      <F label="응답 직전 지시 (선택)" hint="AI가 응답(소설은 회차)을 쓰기 직전에 매번 전달됩니다. 상태창 형식, 그림 표시 규칙처럼 꼭 지켜야 하는 출력 규칙을 적습니다. RisuAI 카드의 post_history_instructions가 여기로 들어옵니다.">
        <textarea className="input min-h-20" value={c.instructions ?? ""} onChange={(e) => up({ instructions: e.target.value })} aria-label="응답 직전 지시" />
      </F>
      </Section>
      <Section id="lib-greetings"><GreetingsEditor c={c} onStart={onStart} /></Section>
      <Section id="lib-lore"><LoreEditor entries={c.lore} onChange={(lore) => up({ lore })} /></Section>
      <Section id="lib-images"><ImageGallery ownerId={c.id} /></Section>
      <Section id="lib-scripts"><RisuSettings e={c} /></Section>
    </>
  );
}

function PersonaForm({ p }: { p: Persona }) {
  const up = (x: Partial<Persona>) => updateEntity<Persona>(p.id, x);
  return (
    <Section id="lib-basic">
      <F label="이름"><input className="input" value={p.name} onChange={(e) => up({ name: e.target.value })} aria-label="주인공 이름" /></F>
      <F label="주인공 소개" hint="AI가 다른 인물의 반응을 쓸 때 참고합니다. 나이, 외모, 직업, 처지 등">
        <textarea className="input min-h-36" value={p.profile} onChange={(e) => up({ profile: e.target.value })} aria-label="주인공 소개" />
      </F>
    </Section>
  );
}
