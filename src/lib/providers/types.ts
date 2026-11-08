import type { Settings } from "../types";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
export interface Usage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}
export interface GenerateRequest {
  settings: Settings;
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  /** 생각(사고)을 줄여 달라고 요청 (생각만 하다 출력 한도를 다 쓴 뒤 다시 시도할 때) */
  lessThinking?: boolean;
  signal?: AbortSignal;
  onText?: (delta: string) => void;
  onThinking?: (delta: string) => void;
  onStatus?: (message: string) => void;
}
export interface GenerateResult {
  text: string;
  thinking?: string;
  model: string;
  usage?: Usage;
  stopReason?: string;
}
export class ProviderError extends Error {
  constructor(message: string, public status = 0, public kind: "auth" | "refusal" | "rate" | "server" | "request" | "network" = "request") {
    super(message);
    this.name = "ProviderError";
  }
}
