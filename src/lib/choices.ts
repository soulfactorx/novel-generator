/** AI 응답의 선택지 블록을 분리합니다.
 *  형식: 본문 … "[선택지]" 줄 다음 "1. …" 목록.
 *  봇이 응답 맨 끝에 쓰라고 한 출력(상태창 등)이 선택지 뒤에 오면, 그 부분은 본문으로 되돌립니다. */
export const CHOICE_MARKER = "[선택지]";
const MARKER_RE = /\n?[ \t]*\[\s*선택지\s*\][ \t]*\n/;
const ITEM_RE = /^\s*(?:\d+[.)]|[-*•])\s+\S/;

export function splitChoices(raw: string): { text: string; choices: string[] } {
  const src = raw.replace(/\r\n/g, "\n");
  const m = MARKER_RE.exec(src);
  if (!m) return { text: src.trim(), choices: [] };
  const before = src.slice(0, m.index).trimEnd();
  const lines = src.slice(m.index + m[0].length).split("\n");
  const choices: string[] = [];
  let k = 0;
  while (k < lines.length && !lines[k].trim()) k++; // 표시 다음 빈 줄
  for (; k < lines.length; k++) {
    const l = lines[k];
    if (ITEM_RE.test(l)) choices.push(l.trim().replace(/^(\d+[.)]|[-*•])\s*/, "").trim());
    else if (!l.trim() && k + 1 < lines.length && ITEM_RE.test(lines[k + 1])) continue; // 항목 사이 빈 줄
    else break;
  }
  const after = lines.slice(k).join("\n").trim();
  return { text: [before, after].filter(Boolean).join("\n\n"), choices: choices.slice(0, 6) };
}

/** 스트리밍 중 미리보기: 선택지 블록은 숨기고, 그 뒤에 오는 본문(상태창 등)은 보여줍니다. */
export function previewText(partial: string): string {
  if (MARKER_RE.test(partial)) return splitChoices(partial).text;
  const i = partial.indexOf(CHOICE_MARKER.slice(0, 4)); // "[선택지" 가 도착했지만 줄바꿈 전
  if (i !== -1) return partial.slice(0, i).trimEnd();
  // 끝부분에 표시가 일부만 도착한 경우("[", "[선", "[선택") 그 조각을 숨김
  const j = partial.lastIndexOf("[");
  if (j !== -1 && CHOICE_MARKER.startsWith(partial.slice(j))) return partial.slice(0, j).trimEnd();
  return partial.trimEnd();
}
