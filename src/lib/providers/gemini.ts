import { readSSE } from "../sse";
import { errorBody, fetchRetry, kindFor } from "./http";
import { ProviderError, type GenerateRequest, type GenerateResult } from "./types";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

interface GPart { text?: string; thought?: boolean }
interface GChunk {
  candidates?: { content?: { parts?: GPart[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number };
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

export async function generateGemini(req: GenerateRequest): Promise<GenerateResult> {
  const { settings: s } = req;
  const key = s.keys.gemini.trim();
  if (!key) throw new ProviderError("Gemini API 키가 없습니다. [설정]에서 입력해 주세요.", 0, "auth");
  const model = s.models.gemini.trim() || "gemini-3.8-flash";
  const body = {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    generationConfig: { temperature: s.temperature, maxOutputTokens: req.maxTokens + 8192 }, // 사고 토큰 여유
    ...(s.contentRating === "adult"
      ? { safetySettings: ["HARASSMENT", "HATE_SPEECH", "SEXUALLY_EXPLICIT", "DANGEROUS_CONTENT"].map((c) => ({ category: `HARM_CATEGORY_${c}`, threshold: "BLOCK_ONLY_HIGH" })) }
      : {}),
  };
  const url = `${BASE}/models/${encodeURIComponent(model)}:${s.streaming ? "streamGenerateContent?alt=sse&" : "generateContent?"}key=${encodeURIComponent(key)}`;
  const res = await fetchRetry(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, { signal: req.signal, onStatus: req.onStatus, label: "Gemini" });
  if (!res.ok) {
    const e = await errorBody(res);
    throw new ProviderError(`Gemini 오류 (${res.status}): ${e.message}`, res.status, kindFor(res.status));
  }
  let text = "", thinking = "", finish = "", block = "";
  let usage: GChunk["usageMetadata"];
  const take = (j: GChunk) => {
    if (j.error) throw new ProviderError(`Gemini 오류: ${j.error.message}`, 0, "server");
    if (j.usageMetadata) usage = j.usageMetadata;
    if (j.promptFeedback?.blockReason) block = j.promptFeedback.blockReason;
    const c = j.candidates?.[0];
    if (!c) return;
    if (c.finishReason) finish = c.finishReason;
    for (const p of c.content?.parts ?? []) {
      if (!p.text) continue;
      if (p.thought) {
        thinking += p.text;
        req.onThinking?.(p.text);
      } else {
        text += p.text;
        req.onText?.(p.text);
      }
    }
  };
  if (s.streaming && res.body) {
    await readSSE(res.body, (_e, d) => {
      if (!d || d === "[DONE]") return;
      try {
        take(JSON.parse(d));
      } catch (err) {
        if (err instanceof ProviderError) throw err;
      }
    }, req.signal);
  } else take(await res.json());
  if (!text && (block || finish === "SAFETY" || finish === "PROHIBITED_CONTENT"))
    throw new ProviderError(`Gemini 안전 정책으로 응답이 차단되었습니다 (${block || finish}).`, 0, "refusal");
  const u = usage || {};
  return {
    text,
    thinking: thinking || undefined,
    model,
    stopReason: finish,
    usage: { input: (u.promptTokenCount ?? 0) - (u.cachedContentTokenCount ?? 0), output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), cacheRead: u.cachedContentTokenCount ?? 0 },
  };
}
