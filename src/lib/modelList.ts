import { apiRoot } from "./providers/openai";

/** 키로 사용 가능한 모델 목록 (Gemini·OpenAI 호환은 브라우저에서 조회 가능, Claude 는 CORS 미지원 → 카탈로그 사용) */
export async function listModels(provider: "gemini" | "openai", key: string, baseUrl: string): Promise<string[]> {
  if (provider === "gemini") {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error(`목록 조회 실패 (${res.status})`);
    const j = await res.json();
    return (j.models ?? [])
      .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m: { name: string }) => m.name.replace(/^models\//, ""))
      .filter((id: string) => !/(tts|image|live|embedding|transcribe|robotics)/i.test(id))
      .sort();
  }
  const res = await fetch(apiRoot(baseUrl) + "/models", { headers: key ? { authorization: `Bearer ${key}` } : {} });
  if (!res.ok) throw new Error(`목록 조회 실패 (${res.status})`);
  const j = await res.json();
  return ((Array.isArray(j) ? j : j.data) ?? []).map((m: { id?: string } | string) => (typeof m === "string" ? m : m.id)).filter(Boolean).sort();
}
