import { readSSE } from "../sse";
import { claudeInfo } from "./catalog";
import { errorBody, fetchRetry, kindFor } from "./http";
import { ProviderError, type GenerateRequest, type GenerateResult } from "./types";

const URL_MESSAGES = "https://api.anthropic.com/v1/messages";

type Block = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };
interface Body {
  model: string;
  max_tokens: number;
  system: Block[];
  messages: { role: "user" | "assistant"; content: Block[] }[];
  stream: boolean;
  temperature?: number;
}

export function buildClaudeBody(req: GenerateRequest): Body {
  const s = req.settings;
  const model = s.models.anthropic.trim() || "claude-sonnet-5-5";
  const info = claudeInfo(model);
  const messages: Body["messages"] = req.messages.map((m) => ({ role: m.role, content: [{ type: "text", text: m.content }] }));
  // 프롬프트 캐싱: 시스템 프롬프트 + 직전 대화까지 (다음 턴에도 같은 앞부분 재사용)
  if (messages.length >= 3) messages[messages.length - 2].content[0].cache_control = { type: "ephemeral" };
  let maxTokens = req.maxTokens + (info.thinksByDefault ? 16000 : 0); // 사고 토큰도 출력 한도에 포함됨
  if (info.maxOutput) maxTokens = Math.min(maxTokens, info.maxOutput);
  const body: Body = {
    model,
    max_tokens: maxTokens,
    system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
    messages,
    stream: s.streaming,
  };
  if (info.temperature) body.temperature = s.temperature; // 최신 모델은 temperature 를 거부함
  return body;
}

export async function generateClaude(req: GenerateRequest): Promise<GenerateResult> {
  const key = req.settings.keys.anthropic.trim();
  if (!key) throw new ProviderError("Anthropic API 키가 없습니다. [설정]에서 입력해 주세요.", 0, "auth");
  const body = buildClaudeBody(req);
  const headers = {
    "content-type": "application/json",
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
  let res: Response;
  for (let fix = 0; ; fix++) {
    res = await fetchRetry(URL_MESSAGES, { method: "POST", headers, body: JSON.stringify(body) }, { signal: req.signal, onStatus: req.onStatus, label: "Claude" });
    if (res.ok || res.status !== 400 || fix >= 2) break;
    const e = await errorBody(res.clone());
    const m = /max_tokens:\s*\d+\s*>\s*(\d+)/.exec(e.message);
    if (m) body.max_tokens = Number(m[1]);
    else if (body.temperature !== undefined && /temperature/i.test(e.message)) delete body.temperature;
    else break;
  }
  if (!res.ok) {
    const e = await errorBody(res);
    const msg =
      res.status === 401 ? "Anthropic API 키가 올바르지 않습니다." :
      /credit balance/i.test(e.message) ? "Anthropic 크레딧이 부족합니다. platform.claude.com 에서 충전해 주세요." :
      res.status === 404 ? `모델 '${body.model}'을(를) 찾을 수 없습니다. 설정에서 다른 모델을 선택해 주세요.` :
      res.status === 529 ? "Claude 서버가 과부하 상태입니다. 잠시 후 다시 시도해 주세요." :
      `Claude 오류 (${res.status}): ${e.message}`;
    throw new ProviderError(msg, res.status, kindFor(res.status));
  }
  let text = "", thinking = "", stop = "", model = body.model;
  let refusal: { category?: string; explanation?: string } | undefined;
  const usage: Record<string, number> = {};
  const addUsage = (u?: Record<string, unknown>) => {
    for (const k in u ?? {}) if (typeof u![k] === "number") usage[k] = u![k] as number;
  };
  if (body.stream && res.body) {
    let streamErr = "";
    await readSSE(res.body, (_e, d) => {
      let j: any;
      try {
        j = JSON.parse(d);
      } catch {
        return;
      }
      if (j.type === "message_start") {
        model = j.message?.model || model;
        addUsage(j.message?.usage);
      } else if (j.type === "content_block_delta") {
        if (j.delta?.type === "text_delta") {
          text += j.delta.text;
          req.onText?.(j.delta.text);
        } else if (j.delta?.type === "thinking_delta" && j.delta.thinking) {
          thinking += j.delta.thinking;
          req.onThinking?.(j.delta.thinking);
        }
      } else if (j.type === "message_delta") {
        stop = j.delta?.stop_reason || stop;
        refusal = j.delta?.stop_details || j.stop_details || refusal;
        addUsage(j.usage);
      } else if (j.type === "error") streamErr = j.error?.message || "stream error";
    }, req.signal);
    if (streamErr) throw new ProviderError(`Claude 스트림 오류: ${streamErr}`, 0, "server");
  } else {
    const j = await res.json();
    model = j.model || model;
    stop = j.stop_reason;
    refusal = j.stop_details;
    addUsage(j.usage);
    for (const b of j.content ?? []) {
      if (b.type === "text") text += b.text;
      else if (b.type === "thinking") thinking += b.thinking || "";
    }
  }
  if (stop === "refusal") {
    const why = [refusal?.category, refusal?.explanation].filter(Boolean).join(": ");
    throw new ProviderError(`Claude가 이번 요청에 대한 응답을 거절했습니다${why ? ` (${why})` : ""}. 마지막 입력을 수정해 다시 시도해 주세요.`, 0, "refusal");
  }
  return {
    text,
    thinking: thinking || undefined,
    model,
    stopReason: stop,
    usage: { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0, cacheRead: usage.cache_read_input_tokens ?? 0, cacheWrite: usage.cache_creation_input_tokens ?? 0 },
  };
}
