/**
 * 봇 화면의 라디오·체크박스 상태 기억 (예: 옆 탭 접기/펼치기, 열린 패널).
 * 봇은 턴마다 화면 HTML을 새로 만들어 기본 상태로 되돌리므로, 사용자가 마지막으로 고른 상태를 기억했다가 다시 적용한다.
 * 이름·id는 턴마다 바뀌므로 종류·class·data-* 속성·값으로 같은 컨트롤을 알아본다 (data-* 가 없으면 기억하지 않음).
 */
const KEY = "risuUiState";
let memory: Record<string, boolean> | null = null;
const load = (): Record<string, boolean> => {
  if (memory) return memory;
  try {
    memory = JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
  } catch {
    memory = {};
  }
  return memory!;
};
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(memory ?? {}));
  } catch {
    /* 저장 못 해도 이번 실행 동안은 기억 */
  }
};

export function controlKey(el: Element): string | null {
  if (!(el instanceof HTMLInputElement) || (el.type !== "radio" && el.type !== "checkbox")) return null;
  const data = [...el.attributes].filter((a) => a.name.startsWith("data-")).map((a) => `${a.name}=${a.value}`).sort();
  if (!data.length) return null;
  return [el.type, el.className, ...data, el.value].join("|");
}

/** 사용자가 바꾼 컨트롤 기억 (라디오는 같은 그룹 전체) */
export function rememberControl(el: Element, root: ParentNode) {
  const key = controlKey(el);
  if (!key) return;
  const m = load();
  const input = el as HTMLInputElement;
  const group = input.type === "radio" && input.name ? [...root.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(input.name)}"]`)] : [input];
  for (const r of group) {
    const k = controlKey(r);
    if (k) m[k] = r.checked;
  }
  save();
}

/** 새로 그린 화면에 기억한 상태 적용 */
export function restoreControls(root: ParentNode) {
  const m = load();
  if (!Object.keys(m).length) return;
  for (const el of root.querySelectorAll<HTMLInputElement>('input[type="radio"],input[type="checkbox"]')) {
    const k = controlKey(el);
    if (!k || !(k in m)) continue;
    if (el.type === "checkbox") el.checked = m[k];
    else if (m[k]) el.checked = true; // 라디오: 고른 것만 켜면 나머지는 저절로 꺼짐
  }
}

/** 테스트용 */
export function resetUiMemory() {
  memory = {};
  save();
}
