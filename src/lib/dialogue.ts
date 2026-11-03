/**
 * 대사 색: 본문의 따옴표 대사("…", “…”, 「…」, 『…』)를 일반 글과 다른 색으로 보여 준다.
 * 색은 index.css 의 .dlg (설정에서 고른 색이 있으면 --dlg-user).
 */

const QUOTE = /"[^"\n]{1,600}"|“[^”\n]{1,600}”|「[^」\n]{1,600}」|『[^』\n]{1,600}』/g;

/** 글 안의 대사 위치 */
export function findQuotes(text: string): { start: number; end: number }[] {
  return [...text.matchAll(QUOTE)].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
}

/** 일반 글: [글, 대사인지] 조각으로 */
export function splitDialogue(text: string): { text: string; quote?: boolean }[] {
  const found = findQuotes(text);
  if (!found.length) return [{ text }];
  const out: { text: string; quote?: boolean }[] = [];
  let at = 0;
  for (const f of found) {
    if (f.start > at) out.push({ text: text.slice(at, f.start) });
    out.push({ text: text.slice(f.start, f.end), quote: true });
    at = f.end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

const SKIP = new Set(["STYLE", "SCRIPT", "CODE", "PRE", "BUTTON", "LABEL", "OPTION", "SELECT", "TEXTAREA", "SUMMARY"]);
/** HTML(정리된 봇 화면): 글자 노드 안의 대사를 <span class="dlg"> 로 감싼다 (버튼·코드 등은 그대로) */
export function colorizeHtml(html: string): string {
  if (typeof document === "undefined" || !/["“「『]/.test(html)) return html;
  const box = document.createElement("template");
  box.innerHTML = html;
  const root = box.content;
  const nodes: { node: Text; start: number }[] = [];
  let text = "";
  const walk = (n: Node) => {
    for (const c of [...n.childNodes]) {
      if (c.nodeType === 3) {
        nodes.push({ node: c as Text, start: text.length });
        text += (c as Text).data;
      } else if (c.nodeType === 1 && !SKIP.has((c as Element).tagName)) {
        const block = /^(P|DIV|SECTION|ARTICLE|LI|TR|H[1-6]|BLOCKQUOTE|BR|ASIDE|DETAILS)$/.test((c as Element).tagName);
        if (block) text += "\n";
        walk(c);
        if (block) text += "\n";
      }
    }
  };
  walk(root);
  const found = findQuotes(text);
  if (!found.length) return html;
  for (const f of [...found].reverse()) {
    for (const { node, start } of [...nodes].reverse()) {
      const len = node.data.length;
      const a = Math.max(f.start, start) - start;
      const b = Math.min(f.end, start + len) - start;
      if (a >= b || a < 0 || b > len) continue;
      if (b < len) node.splitText(b);
      const mid = a > 0 ? node.splitText(a) : node;
      const span = document.createElement("span");
      span.className = "dlg";
      mid.replaceWith(span);
      span.appendChild(mid);
    }
  }
  const out = document.createElement("div");
  out.appendChild(root);
  return out.innerHTML;
}
