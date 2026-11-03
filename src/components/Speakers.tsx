import { createContext, useContext, useMemo, type ReactNode } from "react";
import { makeSpeakers, type Speaker } from "../lib/dialogue";
import type { StoryContext } from "../lib/prompt";
import { useApp } from "../lib/store";
import { USER_FALLBACK } from "../lib/risuRuntime";

/** 이 화면(이야기·소설)의 화자 목록 — 대사 색에 씀. null 이면 색 넣지 않음 */
const Ctx = createContext<Speaker[] | null>(null);
export const useSpeakers = () => useContext(Ctx);

export function SpeakersProvider({ ctx, children }: { ctx: StoryContext; children: ReactNode }) {
  const on = useApp((s) => s.settings.dialogueColors);
  const key = [...ctx.characters.map((c) => `${c.id}|${c.name}|${c.aliases ?? ""}|${c.color ?? ""}`), ctx.persona ? `${ctx.persona.id}|${ctx.persona.name}|${ctx.persona.aliases ?? ""}|${ctx.persona.color ?? ""}` : ""].join("\n");
  const speakers = useMemo(
    // 주인공을 정하지 않은 이야기는 본문에서 '주인공'으로 불린다 ({{user}} 기본값)
    () => (on ? makeSpeakers([...ctx.characters, ...(ctx.persona ? [ctx.persona] : [{ name: USER_FALLBACK }])].map((c) => ({ name: c.name, aliases: "aliases" in c ? c.aliases : undefined, color: "color" in c ? c.color : undefined }))) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [on, key],
  );
  return <Ctx.Provider value={speakers}>{children}</Ctx.Provider>;
}
