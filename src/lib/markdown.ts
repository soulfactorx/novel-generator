/**
 * 가벼운 마크다운 (RisuAI 본문처럼): **굵게** · *기울임* · ~~취소선~~ · `코드`
 * 태그 안(속성)과 <style>·<pre> 안은 건드리지 않는다.
 */
export function inlineMarkdown(html: string): string {
  if (!/[*~`]/.test(html)) return html;
  const parts = html.split(/(<style\b[\s\S]*?<\/style>|<pre\b[\s\S]*?<\/pre>|<[^>]+>)/i);
  return parts
    .map((p, i) => {
      if (i % 2 === 1) return p; // 태그
      return p
        .replace(/`([^`\n]+)`/g, "<code>$1</code>")
        .replace(/\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*\w])\*(?=\S)([^*\n]+?)(?<=\S)\*(?!\w)/g, "$1<em>$2</em>")
        .replace(/~~(?=\S)([^~\n]+?)(?<=\S)~~/g, "<del>$1</del>");
    })
    .join("");
}
