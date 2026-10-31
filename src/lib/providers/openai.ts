import { readSSE } from "../sse";
import { errorBody, fetchRetry, kindFor } from "./http";
import { ProviderError, type GenerateRequest, type GenerateResult } from "./types";

/** base URL 에서 /chat/completions, /models 가 붙을 루트를 계산 */
export function apiRoot(base: string): string {
  let r = (base || "https://openrouter.ai/api/v1").trim().replace(/\/+$/, "");
  r = r.replace(/\/(chat\/completions|completions|models)$/i, "");
  return /\/(v\d+[a-z0-9.]*|openai)$/i.test(r) ? r : r + "/v1";
}

export async function generateOpenAI(req: GenerateRequest): Promise<GenerateResult> {
  const s = req.settings;
  const local = /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(s.openaiBaseUrl);
  const key = s.keys.openai.trim();
  if (!key && !local) throw new ProviderError("API 키가 없습니다. [설정]에서 입력해 주세요.", 0, "auth");
  const model = s.models.openai.trim() || "gpt-4.1";
  const reasoning = /^(o\d|gpt-5)/i.test(model);
  const base: Record<string, unknown> = {
    model,
    messages: [{ role: "system", content: req.system }, ...req.messages],
    ...(reasoning ? { max_completion_tokens: req.maxTokens + 8000 } : { max_tokens: req.maxTokens, temperature: s.temperature }),
  };
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers.authorization = `Bearer ${key}`;
  const url = apiRoot(s.openaiBaseUrl) + "/chat/completions";
  let stream = s.streaming;
  let res: Response;
  for (;;) {
    const body = stream ? { ...base, stream: true, ...(/openai\.com|openrouter\.ai/.test(url) ? { stream_options: { include_usage: true } } : {}) } : base;
    res = await fetchRetry(url, { method: "POST", headers, body: JSON.stringify(body) }, { signal: req.signal, onStatus: req.onStatus, label: "API" });
    if (!res.ok && stream && res.status === 400) {
      const e = await errorBody(res.clone());
      if (/stream/i.test(e.message)) {
        stream = false; // 스트리밍 미지원 모델/계정 → 일반 요청으로 재시도
        continue;
      }
    }
    break;
  }
  if (!res.ok) {
    const e = await errorBody(res);
    throw new ProviderError(`API 오류 (${res.status}): ${e.message}`, res.status, kindFor(res.status));
  }
  let text = "", thinking = "", finish = "", outModel = model;
  let usage: any;
  const take = (j: any) => {
    if (j.error) throw new ProviderError(`API 오류: ${j.error.message || j.error}`, 0, "server");
    if (j.model) outModel = j.model;
    if (j.usage) usage = j.usage;
    const c = j.choices?.[0];
    if (!c) return;
    const d = c.delta ?? c.message ?? {};
    if (typeof d.content === "string" && d.content) {
      text += d.content;
      req.onText?.(d.content);
    }
    const r = d.reasoning_content ?? d.reasoning;
    if (typeof r === "string" && r) {
      thinking += r;
      req.onThinking?.(r);
    }
    if (c.finish_reason) finish = c.finish_reason;
  };
  const ct = res.headers.get("content-type") || "";
  if (stream && res.body && ct.includes("event-stream")) {
    await readSSE(res.body, (_e, d) => {
      if (!d || d.trim() === "[DONE]") return;
      try {
        take(JSON.parse(d));
      } catch (err) {
        if (err instanceof ProviderError) throw err;
      }
    }, req.signal);
  } else take(await res.json());
  if (finish === "content_filter" && !text) throw new ProviderError("콘텐츠 필터로 응답이 차단되었습니다.", 0, "refusal");
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return { text, thinking: thinking || undefined, model: outModel, stopReason: finish, usage: usage ? { input: (usage.prompt_tokens ?? 0) - cached, output: usage.completion_tokens ?? 0, cacheRead: cached } : undefined };
}
