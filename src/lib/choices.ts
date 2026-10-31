/** AI 응답 끝의 선택지 블록을 분리합니다.
 *  형식: 본문 … 마지막에 "[선택지]" 줄 다음 "1. …" 목록 */
export const CHOICE_MARKER = "[선택지]";

export function splitChoices(raw: string): { text: string; choices: string[] } {
  const src = raw.replace(/\r\n/g, "\n");
  const m = /\n?\s*\[\s*선택지\s*\]\s*\n/.exec(src);
  if (!m) return { text: src.trim(), choices: [] };
  const text = src.slice(0, m.index).trim();
  const choices = src
    .slice(m.index + m[0].length)
    .split("\n")
    .map((l) => l.trim().replace(/^(\d+[.)]|[-*•])\s*/, "").trim())
    .filter((l) => l.length > 0)
    .slice(0, 6);
  return { text, choices };
}

/** 스트리밍 중 미리보기: 선택지 블록이 시작되면 그 앞까지만 보여줍니다. */
export function previewText(partial: string): string {
  const i = partial.indexOf(CHOICE_MARKER.slice(0, 4)); // "[선택지" 가 온전히 도착한 경우
  if (i !== -1) return partial.slice(0, i).trimEnd();
  // 끝부분에 표시가 일부만 도착한 경우("[", "[선", "[선택") 그 조각을 숨김
  const j = partial.lastIndexOf("[");
  if (j !== -1 && CHOICE_MARKER.startsWith(partial.slice(j))) return partial.slice(0, j).trimEnd();
  return partial.trimEnd();
}
