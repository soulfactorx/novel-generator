import { useRef, useState } from "react";
import { imagePool } from "../lib/images";
import RisuText from "./RisuText";
import { useImageUrls } from "../lib/imageUrls";
import { addImages, deleteImages, renameImage, updateEntity, useApp } from "../lib/store";
import type { Character, ImageMeta, RegexScript, World } from "../lib/types";

const KIND_LABEL: Record<ImageMeta["kind"], string> = { asset: "에셋", emotion: "감정", icon: "대표" };
const SCRIPT_LABEL: Record<string, string> = { editinput: "입력 수정", editoutput: "출력 수정", editprocess: "프롬프트 수정", editdisplay: "표시 수정" };

/** 등장인물·세계관의 이미지 (RisuAI 에셋·감정 이미지) */
export function ImageGallery({ ownerId }: { ownerId: string }) {
  const all = useApp((s) => s.images);
  const list = Object.values(all).filter((m) => m.ownerId === ownerId).sort((a, b) => a.createdAt - b.createdAt);
  const urls = useImageUrls(list);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(list.length <= 24);
  const add = async (files: FileList) => {
    setBusy(true);
    await addImages([...files].map((f) => ({ ownerId, name: f.name.replace(/\.[^.]+$/, ""), kind: "asset" as const, load: async () => new Uint8Array(await f.arrayBuffer()) })));
    setBusy(false);
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="label mb-0">🖼 이미지 {list.length > 0 && `${list.length}장`}</span>
        {list.length > 24 && <button className="btn-ghost px-2 py-0.5 text-xs" onClick={() => setOpen(!open)}>{open ? "접기" : "펼치기"}</button>}
        <button className="btn-ghost ml-auto px-2 py-0.5 text-xs" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "저장 중…" : "+ 이미지 추가"}</button>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) void add(e.target.files); e.target.value = ""; }} />
      </div>
      {list.length === 0 && <p className="hint">AI가 {"{{img::이름}}"} 으로 부를 수 있는 그림입니다. RisuAI 캐릭터 카드(charx)를 가져오면 봇의 에셋·감정 이미지가 여기에 들어옵니다.</p>}
      {open && list.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {list.map((m) => (
            <div key={m.id} className="space-y-1 rounded-lg border border-stone-200 p-1 dark:border-stone-800">
              <div className="relative aspect-square overflow-hidden rounded bg-stone-100 dark:bg-stone-800">
                {urls[m.id] && <img src={urls[m.id]} alt={m.name} className="h-full w-full object-cover" loading="lazy" />}
                <button className="absolute right-0.5 top-0.5 rounded bg-black/50 px-1 text-xs text-white" onClick={() => { if (confirm(`'${m.name}' 이미지를 삭제할까요?`)) void deleteImages([m.id]); }} aria-label={`${m.name} 삭제`}>✕</button>
              </div>
              <input className="w-full rounded bg-transparent px-1 text-xs outline-none focus:bg-stone-100 dark:focus:bg-stone-800" defaultValue={m.name} key={m.name} onBlur={(e) => e.target.value.trim() && e.target.value !== m.name && void renameImage(m.id, e.target.value)} aria-label="이미지 이름" title="AI가 이 이름으로 그림을 부릅니다" />
              <select className="w-full bg-transparent text-[11px] text-stone-500" value={m.kind} onChange={(e) => void renameImage(m.id, m.name, e.target.value as ImageMeta["kind"])} aria-label="이미지 종류">
                {(Object.keys(KIND_LABEL) as ImageMeta["kind"][]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** RisuAI 정규식 스크립트(켜기·끄기·고치기·추가·삭제) · 감정 이미지 모드 */
export function RisuSettings({ e }: { e: Character | World }) {
  const images = useApp((s) => s.images);
  const scripts = e.scripts ?? [];
  const [edit, setEdit] = useState<number | null>(null);
  const hasEmotions = Object.values(images).some((m) => m.ownerId === e.id && m.kind === "emotion");
  const setScripts = (next: RegexScript[]) => updateEntity<Character | World>(e.id, { scripts: next });
  const patch = (i: number, p: Partial<RegexScript>) => setScripts(scripts.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const badRegex = (src: string) => {
    try {
      new RegExp(src);
      return "";
    } catch (err) {
      return (err as Error).message;
    }
  };
  return (
    <div className="space-y-2">
      {e.kind === "character" && hasEmotions && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={!!e.emotionMode} onChange={(x) => updateEntity<Character>(e.id, { emotionMode: x.target.checked })} />
          <span>응답마다 감정 이미지 보여 주기 <span className="hint block">AI가 장면의 감정에 맞는 감정 이미지를 골라 응답에 넣습니다. (RisuAI의 '감정 이미지' 화면)</span></span>
        </label>
      )}
      <details>
        <summary className="cursor-pointer text-sm font-semibold">⚙️ 정규식 스크립트 {scripts.length}개{scripts.some((x) => x.disabled) && ` (꺼짐 ${scripts.filter((x) => x.disabled).length})`}</summary>
        <p className="hint my-1">AI의 글을 바꾸는 규칙입니다(RisuAI와 같은 형식). '표시 수정'은 화면에만, '출력 수정'은 저장되는 글에, '입력 수정'은 내 입력에, '프롬프트 수정'은 AI에게 보내는 대화에 적용됩니다. 끈 규칙은 지우지 않고 보관합니다.</p>
        <ul className="space-y-1">
          {scripts.map((sc, i) => (
            <li key={i} className={`rounded bg-stone-100 px-2 py-1 text-xs dark:bg-stone-800 ${sc.disabled ? "opacity-50" : ""}`}>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={!sc.disabled} onChange={(x) => patch(i, { disabled: !x.target.checked })} aria-label={`${sc.comment || "스크립트"} 켜기`} />
                <span className="shrink-0 rounded bg-violet-100 px-1 text-violet-700 dark:bg-violet-950 dark:text-violet-300">{SCRIPT_LABEL[sc.type] ?? sc.type}</span>
                <button className="min-w-0 flex-1 truncate text-left" title={`${sc.in}\n→ ${sc.out.slice(0, 300)}`} onClick={() => setEdit(edit === i ? null : i)}>{sc.comment || sc.in}</button>
                <button className="text-stone-500" onClick={() => setEdit(edit === i ? null : i)} aria-label="스크립트 고치기">✏️</button>
                <button className="text-rose-500" onClick={() => { if (confirm(`'${sc.comment || sc.in}' 스크립트를 삭제할까요?`)) { setScripts(scripts.filter((_, k) => k !== i)); setEdit(null); } }} aria-label="스크립트 삭제">✕</button>
              </div>
              {edit === i && (
                <div className="mt-2 space-y-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input className="input py-1 text-xs" value={sc.comment} onChange={(x) => patch(i, { comment: x.target.value })} placeholder="이름" aria-label="스크립트 이름" />
                    <select className="input py-1 text-xs" value={sc.type} onChange={(x) => patch(i, { type: x.target.value })} aria-label="스크립트 종류">
                      {Object.entries(SCRIPT_LABEL).map(([k, v]) => <option key={k} value={k}>{v} ({k})</option>)}
                    </select>
                  </div>
                  <label className="block"><span className="label">찾을 정규식</span><textarea className="input min-h-14 font-mono text-xs" value={sc.in} onChange={(x) => patch(i, { in: x.target.value })} aria-label="찾을 정규식" /></label>
                  {badRegex(sc.in) && <p className="text-xs text-rose-600">정규식 오류: {badRegex(sc.in)} (이 스크립트는 건너뜁니다)</p>}
                  <label className="block"><span className="label">바꿀 내용 ($1 = 첫 번째 괄호, $n = 줄바꿈)</span><textarea className="input min-h-20 font-mono text-xs" value={sc.out} onChange={(x) => patch(i, { out: x.target.value })} aria-label="바꿀 내용" /></label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!!sc.ableFlag} onChange={(x) => patch(i, { ableFlag: x.target.checked })} /> 플래그 직접 지정 <input className="input w-32 py-0.5 text-xs" disabled={!sc.ableFlag} value={sc.flag ?? ""} onChange={(x) => patch(i, { flag: x.target.value })} placeholder="g, gi, <order 1>" aria-label="플래그" /></label>
                </div>
              )}
            </li>
          ))}
        </ul>
        <button className="btn-ghost mt-1 px-2 py-0.5 text-xs" onClick={() => { setScripts([...scripts, { comment: "새 스크립트", in: "", out: "", type: "editdisplay" }]); setEdit(scripts.length); }}>+ 스크립트 추가</button>
      </details>
    </div>
  );
}

/** 인사말(첫 메시지) 목록: 고치기·추가·삭제, 이 인사말로 새 이야기 */
export function GreetingsEditor({ c, onStart }: { c: Character; onStart: (greeting: string) => void }) {
  const list = c.greetings ?? [];
  const [open, setOpen] = useState<number | null>(null);
  const set = (next: string[]) => updateEntity<Character>(c.id, { greetings: next });
  return (
    <div className="space-y-1">
      <div className="flex items-center">
        <span className="label mb-0">💬 인사말 (첫 메시지) {list.length > 0 && `${list.length}개`}</span>
        <button className="btn-ghost ml-auto px-2 py-0.5 text-xs" onClick={() => { set([...list, ""]); setOpen(list.length); }}>+ 인사말 추가</button>
      </div>
      {list.length === 0 && <p className="hint">새 이야기를 이 인물의 첫 대사·장면으로 시작하고 싶을 때 적어 둡니다. RisuAI 카드의 첫 메시지·다른 인사말이 여기 들어옵니다.</p>}
      {list.map((g, i) => (
        <div key={i} className="rounded-lg border border-stone-200 dark:border-stone-800">
          <div className="flex items-center gap-1 px-2 py-1">
            <button className="min-w-0 flex-1 truncate text-left text-sm" onClick={() => setOpen(open === i ? null : i)} title="펼쳐서 고치기">
              <span className="text-stone-400">{i + 1}.</span> {g.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "(비어 있음)"}
            </button>
            <button className="btn-ghost shrink-0 px-2 py-0.5 text-xs" disabled={!g.trim()} onClick={() => onStart(g)}>▶ 이걸로 새 이야기</button>
            <button className="shrink-0 px-1 text-xs text-rose-500" onClick={() => { if (!g.trim() || confirm(`${i + 1}번 인사말을 삭제할까요?`)) { set(list.filter((_, k) => k !== i)); setOpen(null); } }} aria-label={`${i + 1}번 인사말 삭제`}>✕</button>
          </div>
          {open === i && <textarea className="input min-h-48 rounded-t-none border-x-0 border-b-0 text-sm" value={g} onChange={(x) => set(list.map((v, k) => (k === i ? x.target.value : v)))} aria-label={`${i + 1}번 인사말`} />}
        </div>
      ))}
    </div>
  );
}

/** 가져온 패키지 표시 */
export function PackageBadge({ e }: { e: Character | World }) {
  const images = useApp((s) => s.images);
  if (!e.source) return null;
  const n = Object.values(images).filter((m) => m.ownerId === e.id).length;
  const parts = [e.source.format, n > 0 && `이미지 ${n}장`, e.scripts?.length && `스크립트 ${e.scripts.length}개`, e.kind === "character" && e.greetings?.length && `인사말 ${e.greetings.length}개`, `${new Date(e.source.importedAt).toLocaleDateString("ko-KR")} 가져옴`].filter(Boolean);
  return (
    <div className="rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-800 dark:bg-violet-950/40 dark:text-violet-200">
      📦 <b>RisuAI 패키지</b> · {e.source.file}
      <div className="mt-0.5 opacity-80">{parts.join(" · ")}</div>
      <div className="mt-0.5 opacity-70">모든 내용은 여기서 고쳐 쓸 수 있습니다. 같은 파일을 다시 가져오면 이 패키지를 교체할지 물어봅니다.</div>
    </div>
  );
}

const LANG_NAME: Record<string, string> = { ko: "한국어", en: "English", ja: "日本語", zh: "中文", "zh-cn": "简体中文", "zh-tw": "繁體中文", es: "Español", fr: "Français", de: "Deutsch", ru: "Русский", vi: "Tiếng Việt", th: "ไทย", id: "Bahasa Indonesia" };
/** 제작자 노트 (언어별 노트가 있으면 언어를 골라 보기). AI에게는 보내지 않는다 */
export function CreatorNotes({ c }: { c: Character }) {
  const images = useApp((s) => s.images);
  const byLang = c.notesByLang ?? {};
  const langs = [...(c.notes?.trim() ? ["default"] : []), ...Object.keys(byLang)];
  const pref = (typeof navigator !== "undefined" ? navigator.language : "ko").toLowerCase();
  const initial = langs.find((l) => l.toLowerCase() === pref) ?? langs.find((l) => pref.startsWith(l.toLowerCase().split("-")[0])) ?? langs[0];
  const [lang, setLang] = useState(initial);
  if (!langs.length) return null;
  const cur = langs.includes(lang) ? lang : langs[0];
  const text = cur === "default" ? c.notes ?? "" : byLang[cur] ?? "";
  return (
    <details className="rounded-lg border border-stone-200 dark:border-stone-800">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">📝 제작자 노트{langs.length > 1 && <span className="hint font-normal"> · {langs.length}개 언어</span>}</summary>
      <div className="space-y-2 border-t border-stone-200 px-3 py-2 dark:border-stone-800">
        {langs.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {langs.map((l) => <button key={l} className={`rounded px-2 py-0.5 text-xs ${l === cur ? "bg-violet-600 text-white" : "bg-stone-200/70 dark:bg-stone-800"}`} onClick={() => setLang(l)}>{l === "default" ? "기본" : LANG_NAME[l.toLowerCase()] ?? l}</button>)}
          </div>
        )}
        <div className="max-h-96 overflow-y-auto text-sm"><RisuText text={text} pool={imagePool({ characters: [c] }, images)} /></div>
        <p className="hint">봇 제작자가 남긴 설명입니다. AI에게는 보내지 않습니다.</p>
      </div>
    </details>
  );
}
