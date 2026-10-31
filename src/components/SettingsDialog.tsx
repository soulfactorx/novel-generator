import { useRef, useState, type ReactNode } from "react";
import { backupLibrary, download, isOwnBackup, makeBackup } from "../lib/backup";
import { parseLegacyBackup, type LegacyImport } from "../lib/importLegacy";
import { listModels } from "../lib/modelList";
import { testConnection } from "../lib/providers";
import { CLAUDE_MODELS, GEMINI_MODELS, OPENAI_PRESETS, PROVIDER_LABEL } from "../lib/providers/catalog";
import { RATING_POLICY } from "../lib/prompt";
import { getState, importLegacy, importLegacyExtra, updateSettings, upsertLibrary, upsertRooms, useApp } from "../lib/store";
import type { ContentRating, ProviderId, Room, Settings, StyleOptions } from "../lib/types";
import Dialog from "./Dialog";

const TABS = [["ai", "AI 연결"], ["writing", "글쓰기"], ["rating", "콘텐츠 수위"], ["data", "데이터"]] as const;

export default function SettingsDialog({ initialTab, onClose }: { initialTab: string; onClose: () => void }) {
  const [tab, setTab] = useState(initialTab);
  return (
    <Dialog title="설정" onClose={onClose} wide>
      <div className="mb-4 flex gap-1 overflow-x-auto">
        {TABS.map(([id, label]) => (
          <button key={id} className={`btn whitespace-nowrap ${tab === id ? "bg-violet-600 text-white" : "bg-stone-200/70 dark:bg-stone-800"}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "ai" && <AiTab />}
      {tab === "writing" && <WritingTab />}
      {tab === "rating" && <RatingTab />}
      {tab === "data" && <DataTab />}
    </Dialog>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
      {hint && <p className="hint mt-1">{hint}</p>}
    </div>
  );
}

function AiTab() {
  const s = useApp((x) => x.settings);
  const p = s.provider;
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<{ ok?: boolean; text: string } | null>(null);
  const [fetched, setFetched] = useState<string[]>([]);
  const presets = p === "anthropic" ? CLAUDE_MODELS : p === "gemini" ? GEMINI_MODELS : OPENAI_PRESETS;
  const setKey = (v: string) => updateSettings({ keys: { ...s.keys, [p]: v } });
  const setModel = (v: string) => updateSettings({ models: { ...s.models, [p]: v } });
  const runTest = async () => {
    setTest({ text: "확인 중…" });
    const t0 = Date.now();
    try {
      const r = await testConnection({ settings: getState().settings });
      setTest({ ok: true, text: `✅ 연결 성공 · ${r.model} · ${((Date.now() - t0) / 1000).toFixed(1)}초` });
    } catch (e) {
      setTest({ ok: false, text: `❌ ${(e as Error).message}` });
    }
  };
  const fetchList = async () => {
    if (p === "anthropic") return;
    setTest({ text: "모델 목록 불러오는 중…" });
    try {
      const l = await listModels(p, s.keys[p], s.openaiBaseUrl);
      setFetched(l);
      setTest({ ok: true, text: `✅ ${l.length}개 모델을 불러왔습니다. 모델 입력칸에서 검색해 고르세요.` });
    } catch (e) {
      setTest({ ok: false, text: `❌ ${(e as Error).message}` });
    }
  };
  return (
    <div className="space-y-4">
      <Field label="AI 제공업체">
        <div className="grid grid-cols-3 gap-2">
          {(["gemini", "anthropic", "openai"] as ProviderId[]).map((id) => (
            <button key={id} className={`btn border ${p === id ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300" : "border-stone-300 dark:border-stone-700"}`} onClick={() => { updateSettings({ provider: id }); setFetched([]); setTest(null); }}>
              {PROVIDER_LABEL[id]}
            </button>
          ))}
        </div>
      </Field>
      {p === "openai" && (
        <Field label="API 주소" hint="OpenRouter, OpenAI, 로컬 서버(Ollama 등) 등 OpenAI 호환 주소">
          <input className="input font-mono" value={s.openaiBaseUrl} onChange={(e) => updateSettings({ openaiBaseUrl: e.target.value })} />
        </Field>
      )}
      <Field
        label="API 키"
        hint={<>키는 이 브라우저에만 저장되며, AI 제공업체에 직접 전송됩니다. {p === "gemini" && "aistudio.google.com"}{p === "anthropic" && "platform.claude.com"}{p === "openai" && "제공업체 콘솔"}에서 발급받으세요.</>}
      >
        <div className="flex gap-2">
          <input className="input font-mono" type={showKey ? "text" : "password"} autoComplete="off" value={s.keys[p]} onChange={(e) => setKey(e.target.value.trim())} />
          <button className="btn-ghost" onClick={() => setShowKey(!showKey)}>{showKey ? "숨기기" : "보기"}</button>
        </div>
      </Field>
      <Field label="모델" hint={p === "anthropic" ? "목록에 없는 새 모델은 ID를 직접 입력하세요." : "목록에 없으면 [목록 불러오기]로 이 키에서 쓸 수 있는 모델을 확인하세요."}>
        <input className="input font-mono" list="model-options" value={s.models[p]} onChange={(e) => setModel(e.target.value)} />
        <datalist id="model-options">
          {presets.map((m) => <option key={m.id} value={m.id}>{`${m.label}${m.note ? " · " + m.note : ""}`}</option>)}
          {fetched.filter((id) => !presets.some((m) => m.id === id)).map((id) => <option key={id} value={id} />)}
        </datalist>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {presets.slice(0, 5).map((m) => (
            <button key={m.id} className={`rounded-full border px-2.5 py-1 text-xs ${s.models[p] === m.id ? "border-violet-500 bg-violet-600 text-white" : "border-stone-300 dark:border-stone-700"}`} onClick={() => setModel(m.id)} title={m.note}>
              {m.label}
            </button>
          ))}
        </div>
      </Field>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" onClick={runTest}>⚡ 연결 테스트</button>
        {p !== "anthropic" && <button className="btn-ghost border border-stone-300 dark:border-stone-700" onClick={fetchList}>🔄 목록 불러오기</button>}
      </div>
      {test && <p className={`text-sm font-semibold break-words ${test.ok === false ? "text-rose-600" : test.ok ? "text-emerald-600" : "text-stone-500"}`}>{test.text}</p>}
    </div>
  );
}

function Choice<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([v, l]) => (
        <button key={v} className={`rounded-lg border px-3 py-1.5 text-sm ${value === v ? "border-violet-500 bg-violet-600 text-white" : "border-stone-300 dark:border-stone-700"}`} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

function WritingTab() {
  const s = useApp((x) => x.settings);
  const st = (patch: Partial<StyleOptions>) => updateSettings({ style: { ...s.style, ...patch } });
  return (
    <div className="space-y-5">
      <Field label="시점"><Choice value={s.style.pov} onChange={(pov) => st({ pov })} options={[["third-limited", "3인칭 제한"], ["first", "1인칭"], ["third-omniscient", "3인칭 전지적"]]} /></Field>
      <Field label="한 번에 쓰는 분량"><Choice value={s.style.length} onChange={(length) => st({ length })} options={[["short", "짧게"], ["medium", "보통"], ["long", "길게"]]} /></Field>
      <Field label="전개 속도"><Choice value={s.style.pacing} onChange={(pacing) => st({ pacing })} options={[["fast", "빠르게"], ["balanced", "균형"], ["slow", "천천히·섬세하게"]]} /></Field>
      <Field label="대사 비중"><Choice value={s.style.dialogue} onChange={(dialogue) => st({ dialogue })} options={[["more", "대화 많이"], ["balanced", "균형"], ["less", "서술 위주"]]} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.choices} onChange={(e) => updateSettings({ choices: e.target.checked })} /> 응답 끝에 다음 행동 선택지 4개 제안</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.autoMemory} onChange={(e) => updateSettings({ autoMemory: e.target.checked })} /> 장기 기억 자동 정리 (오래된 대화를 요약해 기억에 반영)</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.streaming} onChange={(e) => updateSettings({ streaming: e.target.checked })} /> 실시간 스트리밍 (쓰는 동안 바로 보기)</label>
      <Field label={`창의성 (temperature) ${s.temperature.toFixed(2)}`} hint="최신 Claude 모델처럼 이 값을 받지 않는 모델에서는 자동으로 제외됩니다.">
        <input type="range" min={0} max={1} step={0.05} value={s.temperature} onChange={(e) => updateSettings({ temperature: Number(e.target.value) })} className="w-full accent-violet-600" />
      </Field>
      <Field label={`AI에게 보내는 최근 메시지 수: ${s.contextMessages}`} hint="많을수록 앞 내용을 잘 기억하지만 비용이 늘어납니다. 이보다 오래된 대화는 장기 기억으로 정리됩니다.">
        <input type="range" min={10} max={200} step={10} value={s.contextMessages} onChange={(e) => updateSettings({ contextMessages: Number(e.target.value) })} className="w-full accent-violet-600" />
      </Field>
      <Field label="화면 테마"><Choice value={s.theme} onChange={(theme) => updateSettings({ theme })} options={[["system", "시스템"], ["light", "밝게"], ["dark", "어둡게"]]} /></Field>
    </div>
  );
}

function RatingTab() {
  const s = useApp((x) => x.settings);
  const set = (r: ContentRating) => updateSettings({ contentRating: r });
  const items: [ContentRating, string, string][] = [
    ["general", "전체 이용가", "기본값. 노골적인 성적·잔혹 묘사 없이 씁니다."],
    ["mature", "성숙 (15+)", "연애·갈등·어두운 주제를 다루되, 친밀한 장면은 암시와 장면 전환으로 처리합니다."],
    ["adult", "성인 (19+)", "성인 확인 후에만 선택할 수 있습니다. 합의된 성인 간의 관계만 다룹니다."],
  ];
  return (
    <div className="space-y-3">
      {items.map(([id, label, desc]) => {
        const locked = id === "adult" && !s.adultConfirmed;
        return (
          <button key={id} disabled={locked} onClick={() => set(id)} className={`card w-full text-left ${s.contentRating === id ? "border-violet-500 ring-2 ring-violet-500/20" : ""} ${locked ? "opacity-50" : ""}`}>
            <div className="font-bold">{s.contentRating === id ? "● " : "○ "}{label}{locked && " 🔒"}</div>
            <div className="hint mt-1">{desc}</div>
          </button>
        );
      })}
      <label className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
        <input type="checkbox" className="mt-1" checked={s.adultConfirmed} onChange={(e) => updateSettings({ adultConfirmed: e.target.checked, ...(e.target.checked ? {} : { contentRating: s.contentRating === "adult" ? "mature" : s.contentRating }) })} />
        <span>본인은 만 19세 이상이며, 성인 콘텐츠를 스스로 선택해 이용합니다. <span className="hint block">확인을 해제하면 '성숙' 등급으로 돌아갑니다.</span></span>
      </label>
      <p className="hint">어느 등급이든 각 AI 제공업체의 이용 정책이 우선 적용되며, 모델이 응답을 거절할 수 있습니다. 미성년자, 비동의 성적 묘사, 실존 인물은 어떤 등급에서도 다루지 않습니다.</p>
      <details className="hint"><summary className="cursor-pointer">현재 등급에서 AI에게 전달되는 지침 보기</summary><p className="mt-2 whitespace-pre-wrap">{RATING_POLICY[s.contentRating]}</p></details>
    </div>
  );
}

function DataTab() {
  const rooms = useApp((x) => x.rooms);
  const library = useApp((x) => x.library);
  const legacyExtra = useApp((x) => x.legacyExtra);
  const settings = useApp((x) => x.settings);
  const fileRef = useRef<HTMLInputElement>(null);
  const [withKeys, setWithKeys] = useState(false);
  const [pending, setPending] = useState<LegacyImport | null>(null);
  const [importKeys, setImportKeys] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const onFile = async (f: File) => {
    try {
      const j = JSON.parse(await f.text());
      if (isOwnBackup(j)) {
        const lib = backupLibrary(j);
        upsertLibrary(lib);
        upsertRooms(j.rooms as Room[]);
        if (j.settings) updateSettings({ ...(j.settings as Partial<Settings>), keys: { ...settings.keys, ...Object.fromEntries(Object.entries((j.settings as Settings).keys || {}).filter(([, v]) => v)) } });
        setMsg({ ok: true, text: `✅ 백업에서 이야기 ${j.rooms.length}개${lib.length ? `, 라이브러리 항목 ${lib.length}개` : ""}를 복원했습니다.` });
      } else setPending(parseLegacyBackup(j));
    } catch (e) {
      setMsg({ ok: false, text: `❌ ${(e as Error).message}` });
    }
  };
  return (
    <div className="space-y-4">
      <div className="card space-y-2">
        <div className="font-bold">💾 백업 내려받기</div>
        <p className="hint">모든 이야기, 세계관·인물, 설정을 JSON 파일로 저장합니다. 데이터는 이 브라우저에만 있으니 가끔 백업해 두세요.</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={withKeys} onChange={(e) => setWithKeys(e.target.checked)} /> API 키 포함 (파일 보관에 주의)</label>
        <button className="btn-primary" onClick={() => download(`novel-generator-backup-${new Date().toISOString().slice(0, 10)}.json`, makeBackup(settings, Object.values(rooms), Object.values(library), withKeys))}>백업 파일 저장</button>
      </div>
      <div className="card space-y-2">
        <div className="font-bold">📥 백업 가져오기</div>
        <p className="hint">이 앱의 백업 파일, 또는 E.No.S Studio의 백업 파일(전체 백업·자동 백업)을 가져올 수 있습니다. 기존 이야기는 지워지지 않습니다.</p>
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
        <button className="btn-ghost border border-stone-300 dark:border-stone-700" onClick={() => fileRef.current?.click()}>파일 선택</button>
        {pending && (
          <div className="space-y-2 rounded-lg bg-violet-50 p-3 text-sm dark:bg-violet-950/40">
            <div>E.No.S 백업: 이야기 <b>{pending.rooms.length}</b>개 · 세계관 <b>{pending.library.filter((e) => e.kind === "world").length}</b>개 · 등장인물 <b>{pending.library.filter((e) => e.kind === "character").length}</b>명 · 주인공 <b>{pending.library.filter((e) => e.kind === "persona").length}</b>명</div>
            {pending.settingsPatch.keys && <label className="flex items-center gap-2"><input type="checkbox" checked={importKeys} onChange={(e) => setImportKeys(e.target.checked)} /> 백업에 있는 API 키도 가져오기</label>}
            <div className="flex gap-2">
              <button className="btn-primary" onClick={() => { importLegacy(pending, importKeys); setMsg({ ok: true, text: `✅ 이야기 ${pending.rooms.length}개를 가져왔습니다.` }); setPending(null); }}>가져오기</button>
              <button className="btn-ghost" onClick={() => setPending(null)}>취소</button>
            </div>
          </div>
        )}
        {legacyExtra && (
          <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
            <div>이전 버전에서 가져올 때 보관해 둔 E.No.S 세계관·캐릭터가 있습니다.</div>
            <button className="btn-primary" onClick={() => setMsg({ ok: true, text: `✅ 라이브러리에 ${importLegacyExtra()}개 항목을 추가했습니다.` })}>라이브러리로 가져오기</button>
          </div>
        )}
        {msg && <p className={`text-sm font-semibold ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
