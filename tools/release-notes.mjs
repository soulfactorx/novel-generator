#!/usr/bin/env node
// CHANGELOG.md 에서 지정 버전(기본: package.json version)의 항목을 출력. 없으면 exit 1.
import { readFileSync } from "node:fs";
const root = new URL("..", import.meta.url);
const v = String(process.argv[2] || JSON.parse(readFileSync(new URL("package.json", root), "utf8")).version).replace(/^v/, "");
const md = readFileSync(new URL("CHANGELOG.md", root), "utf8");
const head = new RegExp(`^## v${v.replace(/\./g, "\\.")}(?![\\d.]).*$`, "m").exec(md);
if (!head) {
  console.error(`CHANGELOG.md 에 "## v${v}" 항목이 없습니다.`);
  process.exit(1);
}
const rest = md.slice(head.index + head[0].length);
const next = rest.search(/^## /m);
const body = (next === -1 ? rest : rest.slice(0, next)).trim();
if (!body) {
  console.error(`"## v${v}" 항목 내용이 비어 있습니다.`);
  process.exit(1);
}
process.stdout.write(body + "\n");
