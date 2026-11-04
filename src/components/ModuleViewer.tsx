/**
 * 모듈 내용 보기 (읽기 전용): 가져온 RisuAI 모듈(세계관)에 무엇이 들어 있는지 탭별로 보여 준다.
 * 개요 · 로어북 · 정규식 스크립트 · 트리거·Lua · 그림 · 배경 HTML
 */
import { useMemo, useState } from "react";
import { luaCodesOf } from "../lib/risuLua";
import { useApp } from "../lib/store";
import type { World } from "../lib/types";
import Dialog from "./Dialog";
import { ImageGallery } from "./ImageManager";

type Tab = "info" | "lore" | "scripts" | "triggers" | "images" | "bg";

/** 아주 긴 코드(수 MB Lua 등)는 앞부분만 그리고 '더 보기'로 늘린다 */
function Code({ text }: { text: string }) {
  const [limit, setLimit] = useState(20_000);
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs text-stone-500">
        <span>{text.length.toLocaleString()}자</span>
        <button className="btn-ghost px-2 py-0.5 text-xs" onClick={() => { void navigator.clipboard?.writeText(text).then(() => setCopied(true)); }}>{copied ? "복사됨" : "복사"}</button>
      </div>
      <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-stone-100 p-2 font-mono text-xs dark:bg-stone-900">{text.slice(0, limit)}</pre>
      {text.length > limit && <button className="btn-ghost px-2 py-0.5 text-xs" onClick={() => setLimit((n) => n * 5)}>… 더 보기 ({(text.length - limit).toLocaleString()}자 남음)</button>}
    </div>
  );
}

function Field({ label, text }: { label: string; text?: string }) {
  if (!text?.trim()) return null;
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-stone-500">{label}</div>
      <Code text={text} />
    </div>
  );
}

export default function ModuleViewer({ module: m, onClose }: { module: World; onClose: () => void }) {
  const imgCount = useApp((s) => Object.values(s.images).filter((x) => x.ownerId === m.id).length);
  const triggers = m.risu?.triggers ?? [];
  const lua = useMemo(() => luaCodesOf(triggers), [triggers]);
  const blocks = triggers.length - triggers.filter((t) => ((t as { effect?: { type?: string }[] }).effect ?? []).some((e) => e?.type === "triggerlua")).length;
  const scripts = m.scripts ?? [];
  const tabs: [Tab, string, number | null][] = [
    ["info", "개요", null],
    ["lore", "로어북", m.lore.length],
    ["scripts", "스크립트", scripts.length],
    ["triggers", "트리거·Lua", triggers.length],
    ["images", "그림", imgCount],
    ["bg", "배경", m.risu?.backgroundHTML ? 1 : 0],
  ];
  const [tab, setTab] = useState<Tab>("info");
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const lore = ql ? m.lore.filter((e) => [e.title, e.content, ...e.keys].some((s) => s?.toLowerCase().includes(ql))) : m.lore;
  const scr = ql ? scripts.filter((s) => [s.comment, s.in, s.out].some((x) => x?.toLowerCase().includes(ql))) : scripts;
  const search = (
    <input className="input py-1 text-sm" placeholder="찾기 (제목·키·내용)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="모듈 내용 찾기" />
  );
  return (
    <Dialog
      title={`🧩 ${m.name}`}
      onClose={onClose}
      size="lg"
      tabs={
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map(([id, label, n]) => (
            <button key={id} className={`btn whitespace-nowrap py-1.5 ${tab === id ? "bg-violet-600 text-white" : "bg-stone-200/70 dark:bg-stone-800"}`} onClick={() => setTab(id)}>
              {label}{n !== null && <span className="ml-1 opacity-70">{n}</span>}
            </button>
          ))}
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        {tab === "info" && (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {m.source && (<><dt className="text-stone-500">가져온 파일</dt><dd className="break-all">{m.source.file} · {m.source.format} · {new Date(m.source.importedAt).toLocaleString()}</dd></>)}
              <dt className="text-stone-500">들어 있는 것</dt>
              <dd>로어 {m.lore.length} · 스크립트 {scripts.length} · 블록 트리거 {blocks} · Lua {lua.length} · 그림 {imgCount}{m.risu?.backgroundHTML ? " · 배경" : ""}</dd>
              {m.risu?.lowLevelAccess && (<><dt className="text-stone-500">권한</dt><dd>저수준 접근 (보조 AI 호출 등)</dd></>)}
            </dl>
            <Field label="설명 (AI에게 전달)" text={m.description} />
            <Field label="규칙·지시 (AI에게 전달)" text={m.rules} />
            <Field label="토글" text={m.risu?.toggles} />
            <Field label="기본 변수" text={m.risu?.defaultVariables} />
            {!m.description && !m.rules && !m.risu?.toggles && !m.risu?.defaultVariables && <p className="hint">설명·규칙·토글·기본 변수는 없습니다. 다른 탭에서 내용을 보세요.</p>}
          </>
        )}
        {tab === "lore" && (
          <>
            {search}
            {lore.length === 0 && <p className="hint">{m.lore.length ? "찾는 항목이 없습니다." : "로어북 항목이 없습니다."}</p>}
            {lore.map((e) => (
              <details key={e.id} className="rounded-lg border border-stone-200 px-3 py-2 dark:border-stone-800">
                <summary className="cursor-pointer">
                  <span className="font-semibold">{e.title || "(제목 없음)"}</span>{" "}
                  <span className="hint">{e.always ? "항상 · " : ""}{e.keys.length ? `키: ${e.keys.join(", ")}` : ""}{e.enabled ? "" : " · 꺼짐"}</span>
                </summary>
                <div className="mt-2 space-y-1">
                  {e.secondKeys?.length ? <div className="hint">보조 키: {e.secondKeys.join(", ")}</div> : null}
                  {e.decorators && <div className="hint font-mono">{e.decorators}</div>}
                  <Code text={e.content} />
                </div>
              </details>
            ))}
          </>
        )}
        {tab === "scripts" && (
          <>
            {search}
            {scr.length === 0 && <p className="hint">{scripts.length ? "찾는 항목이 없습니다." : "정규식 스크립트가 없습니다."}</p>}
            {scr.map((s, i) => (
              <details key={i} className="rounded-lg border border-stone-200 px-3 py-2 dark:border-stone-800">
                <summary className="cursor-pointer">
                  <span className="font-semibold">{s.comment || `스크립트 ${i + 1}`}</span> <span className="hint">{s.type}{s.disabled ? " · 꺼짐" : ""}</span>
                </summary>
                <div className="mt-2 space-y-2">
                  <Field label={`찾기${s.flag ? ` (/${s.flag})` : ""}`} text={s.in} />
                  <Field label="바꾸기" text={s.out || " "} />
                </div>
              </details>
            ))}
          </>
        )}
        {tab === "triggers" && (
          <>
            {triggers.length === 0 && <p className="hint">트리거가 없습니다.</p>}
            {lua.map((code, i) => <Field key={i} label={`Lua 코드${lua.length > 1 ? ` ${i + 1}` : ""}`} text={code} />)}
            {blocks > 0 && <Field label={`블록 트리거 ${blocks}개 (원본 JSON)`} text={JSON.stringify(triggers.filter((t) => !((t as { effect?: { type?: string }[] }).effect ?? []).some((e) => e?.type === "triggerlua")), null, 2)} />}
          </>
        )}
        {tab === "images" && (imgCount ? <ImageGallery ownerId={m.id} /> : <p className="hint">그림이 없습니다.</p>)}
        {tab === "bg" && (m.risu?.backgroundHTML ? <Field label="배경 HTML·CSS" text={m.risu.backgroundHTML} /> : <p className="hint">배경 HTML이 없습니다.</p>)}
      </div>
    </Dialog>
  );
}
