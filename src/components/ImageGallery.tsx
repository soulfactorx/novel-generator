import { useRef, useState } from "react";
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

/** RisuAI 정규식 스크립트 목록 · 감정 이미지 모드 */
export function RisuSettings({ e }: { e: Character | World }) {
  const images = useApp((s) => s.images);
  const scripts = e.scripts ?? [];
  const hasEmotions = Object.values(images).some((m) => m.ownerId === e.id && m.kind === "emotion");
  const setScripts = (next: RegexScript[]) => updateEntity<Character | World>(e.id, { scripts: next });
  if (!scripts.length && !(e.kind === "character" && hasEmotions)) return null;
  return (
    <div className="space-y-2">
      {e.kind === "character" && hasEmotions && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={!!e.emotionMode} onChange={(x) => updateEntity<Character>(e.id, { emotionMode: x.target.checked })} />
          <span>응답마다 감정 이미지 보여 주기 <span className="hint block">AI가 장면의 감정에 맞는 감정 이미지를 골라 응답에 넣습니다. (RisuAI의 '감정 이미지' 화면)</span></span>
        </label>
      )}
      {scripts.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-semibold">⚙️ RisuAI 정규식 스크립트 {scripts.length}개</summary>
          <p className="hint my-1">봇이 정한 글 바꾸기 규칙입니다. 그림 표시를 실제 그림으로 바꾸는 규칙 등이 들어 있습니다. 문제가 되는 규칙은 지울 수 있습니다.</p>
          <ul className="space-y-1">
            {scripts.map((sc, i) => (
              <li key={i} className="flex items-center gap-2 rounded bg-stone-100 px-2 py-1 text-xs dark:bg-stone-800">
                <span className="shrink-0 rounded bg-violet-100 px-1 text-violet-700 dark:bg-violet-950 dark:text-violet-300">{SCRIPT_LABEL[sc.type] ?? sc.type}</span>
                <span className="min-w-0 flex-1 truncate" title={`${sc.in}\n→ ${sc.out}`}>{sc.comment || sc.in}</span>
                <button className="text-rose-500" onClick={() => setScripts(scripts.filter((_, k) => k !== i))} aria-label="스크립트 삭제">✕</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
