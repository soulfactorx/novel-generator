import { useState } from "react";
import { formatTokens, formatUsd, priceFor } from "../lib/pricing";
import { PROVIDER_LABEL } from "../lib/providers/catalog";
import { resetUsage, updateSettings, useApp } from "../lib/store";
import type { ProviderId } from "../lib/types";
import { KIND_LABEL, monthRange, rangeDays, summarize } from "../lib/usage";

const RANGES = [["today", "오늘"], ["7", "7일"], ["30", "30일"], ["month", "이번 달"]] as const;

export default function UsageTab() {
  const usage = useApp((s) => s.usage);
  const settings = useApp((s) => s.settings);
  const [range, setRange] = useState<(typeof RANGES)[number][0]>("month");
  const [from, to] = range === "today" ? rangeDays(1) : range === "month" ? monthRange() : rangeDays(Number(range));
  const sum = summarize(usage, from, to);
  const month = summarize(usage, ...monthRange()).total.usd;
  const krw = (usd: number) => (settings.krwPerUsd ? ` (약 ₩${Math.round(usd * settings.krwPerUsd).toLocaleString()})` : "");
  const max = Math.max(...sum.daily.map((d) => d.usd), 0.000001);
  const t = sum.total;
  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {RANGES.map(([id, l]) => (
          <button key={id} className={`btn flex-1 py-1.5 ${range === id ? "bg-violet-600 text-white" : "bg-stone-200/70 dark:bg-stone-800"}`} onClick={() => setRange(id)}>{l}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="예상 비용" value={formatUsd(t.usd)} sub={krw(t.usd).trim()} />
        <Stat label="요청" value={`${t.n.toLocaleString()}회`} />
        <Stat label="입력 토큰" value={formatTokens(t.in + t.cr + t.cw)} sub={t.cr ? `캐시 적중 ${formatTokens(t.cr)}` : ""} />
        <Stat label="출력 토큰" value={formatTokens(t.out)} />
      </div>
      {t.unpriced > 0 && <p className="text-xs text-amber-600">⚠️ 단가를 모르는 모델의 요청 {t.unpriced}회는 비용에서 빠졌습니다. 아래 [모델별]에서 단가를 직접 넣을 수 있습니다.</p>}
      {sum.daily.length > 1 && (
        <div>
          <span className="label">일별 비용</span>
          <div className="flex h-24 items-end gap-0.5">
            {sum.daily.map((d) => (
              <div key={d.day} className="flex-1 rounded-t bg-violet-500/80" style={{ height: `${Math.max(2, (d.usd / max) * 100)}%` }} title={`${d.day} · ${formatUsd(d.usd)} · ${d.n}회`} />
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-stone-400"><span>{sum.daily[0].day.slice(5)}</span><span>{sum.daily[sum.daily.length - 1].day.slice(5)}</span></div>
        </div>
      )}
      {sum.kinds.length > 0 && (
        <div>
          <span className="label">용도별</span>
          <table className="w-full text-sm">
            <tbody>
              {sum.kinds.map(({ kind, row }) => (
                <tr key={kind} className="border-b border-stone-100 dark:border-stone-800">
                  <td className="py-1">{KIND_LABEL[kind] ?? kind}</td>
                  <td className="py-1 text-right text-stone-500">{row.n}회</td>
                  <td className="py-1 text-right font-mono">{formatUsd(row.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sum.models.length > 0 && (
        <div>
          <span className="label">모델별</span>
          <div className="space-y-1">
            {sum.models.map(({ provider, model, row }) => (
              <ModelRow key={provider + model} provider={provider as ProviderId} model={model} n={row.n} usd={row.usd} unpriced={row.unpriced} tokens={`${formatTokens(row.in + row.cr + row.cw)} → ${formatTokens(row.out)}`} />
            ))}
          </div>
        </div>
      )}
      {t.n === 0 && <p className="hint py-4 text-center">이 기간에는 사용 기록이 없습니다.</p>}
      <div className="card grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="budget">월 예산 (USD, 0 = 끔)</label>
          <input id="budget" type="number" min={0} step={1} className="input" value={settings.monthlyBudget || ""} placeholder="0" onChange={(e) => updateSettings({ monthlyBudget: Number(e.target.value) })} />
          <p className="hint mt-1">이번 달 {formatUsd(month)}{settings.monthlyBudget ? ` / ${formatUsd(settings.monthlyBudget)} · 넘으면 화면 위에 경고를 표시합니다 (요청을 막지는 않습니다).` : ""}</p>
        </div>
        <div>
          <label className="label" htmlFor="krw">원화 환산 (1달러당 원, 0 = 표시 안 함)</label>
          <input id="krw" type="number" min={0} step={10} className="input" value={settings.krwPerUsd || ""} placeholder="0" onChange={(e) => updateSettings({ krwPerUsd: Number(e.target.value) })} />
        </div>
      </div>
      <p className="hint">비용은 각 제공업체의 공개 단가(2026-10-31 기준, Gemini는 기간별 단가 반영)로 이 앱이 계산한 <b>추정치</b>입니다. 무료 등급·할인·세금은 반영하지 않으니 정확한 청구액은 각 콘솔에서 확인하세요.</p>
      {Object.keys(usage.days).length > 0 && <button className="btn-danger text-xs" onClick={() => confirm("사용량 기록을 모두 지울까요?") && resetUsage()}>사용량 기록 초기화</button>}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-stone-500">{label}</div>
      <div className="text-lg font-bold">{value}</div>
      {sub && <div className="truncate text-[11px] text-stone-500">{sub}</div>}
    </div>
  );
}

function ModelRow({ provider, model, n, usd, unpriced, tokens }: { provider: ProviderId; model: string; n: number; usd: number; unpriced: number; tokens: string }) {
  const custom = useApp((s) => s.settings.customPrices);
  const [edit, setEdit] = useState(false);
  const p = priceFor(provider, model, { custom });
  const set = (k: "in" | "out", v: number) => {
    const cur = custom[model] ?? { in: 0, out: 0 };
    updateSettings({ customPrices: { ...custom, [model]: { ...cur, [k]: v } } });
  };
  return (
    <div className="rounded-lg border border-stone-200 px-3 py-2 text-sm dark:border-stone-800">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate"><span className="font-mono">{model}</span> <span className="text-xs text-stone-500">{PROVIDER_LABEL[provider] ?? provider}</span></span>
        <span className="shrink-0 text-xs text-stone-500">{n}회 · {tokens}</span>
        <span className="w-16 shrink-0 text-right font-mono">{unpriced === n ? "?" : formatUsd(usd)}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-stone-500">
        {p ? <span>단가 입력 ${p.in} · 출력 ${p.out} /100만 토큰{custom[model] ? " (직접 입력)" : ""}</span> : <span className="text-amber-600">단가 정보 없음</span>}
        <button className="underline" onClick={() => setEdit(!edit)}>{edit ? "닫기" : "단가 직접 입력"}</button>
      </div>
      {edit && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input type="number" min={0} step={0.01} className="input py-1" placeholder="입력 $/100만" value={custom[model]?.in || ""} onChange={(e) => set("in", Number(e.target.value))} aria-label={`${model} 입력 단가`} />
          <input type="number" min={0} step={0.01} className="input py-1" placeholder="출력 $/100만" value={custom[model]?.out || ""} onChange={(e) => set("out", Number(e.target.value))} aria-label={`${model} 출력 단가`} />
          <p className="hint col-span-2">직접 입력한 단가는 앞으로의 요청부터 적용됩니다. 0으로 두면 기본 단가표를 씁니다.</p>
        </div>
      )}
    </div>
  );
}
