import { useState } from "react";
import { connectSync, disconnectSync, syncNow, updateSyncOptions, useApp } from "../lib/store";

const TOKEN_FINE = "https://github.com/settings/personal-access-tokens/new";
const TOKEN_CLASSIC = "https://github.com/settings/tokens/new?scopes=gist&description=Novel%20Generator%20sync";

export default function SyncSection() {
  const sync = useApp((s) => s.sync);
  const [token, setToken] = useState("");
  const [pass, setPass] = useState("");
  const [auto, setAuto] = useState(true);
  const [showPass, setShowPass] = useState(false);
  const passError = /암호/.test(sync.error ?? "");
  return (
    <div className="card space-y-3">
      <div className="font-bold">🔄 기기 간 동기화 (GitHub Gist)</div>
      {!sync.connected ? (
        <>
          <p className="hint">휴대폰·PC 등 여러 기기에서 같은 이야기·소설·라이브러리·설정을 이어서 쓸 수 있습니다. 데이터는 내 GitHub 계정의 <b>비공개 Gist</b>에 저장되고, Gist의 수정 기록이 자동 백업 역할도 합니다. API 키와 사용량 기록은 동기화하지 않습니다.</p>
          <ol className="hint list-decimal space-y-1 pl-4">
            <li>
              GitHub 토큰 만들기: <a className="text-violet-600 underline" href={TOKEN_FINE} target="_blank" rel="noreferrer">Fine-grained 토큰</a>(Account permissions → <b>Gists: Read and write</b>) 또는{" "}
              <a className="text-violet-600 underline" href={TOKEN_CLASSIC} target="_blank" rel="noreferrer">Classic 토큰</a>(gist 권한만 체크)
            </li>
            <li>아래에 토큰과 동기화 암호를 넣고 연결합니다. 다른 기기에서도 <b>같은 토큰(또는 같은 계정의 토큰)과 같은 암호</b>로 연결하면 됩니다.</li>
          </ol>
          <input className="input font-mono" type="password" autoComplete="off" placeholder="GitHub 토큰 (github_pat_… 또는 ghp_…)" value={token} onChange={(e) => setToken(e.target.value.trim())} aria-label="GitHub 토큰" />
          <div className="flex gap-2">
            <input className="input" type={showPass ? "text" : "password"} autoComplete="new-password" placeholder="동기화 암호 (권장, 비우면 암호화 안 함)" value={pass} onChange={(e) => setPass(e.target.value)} aria-label="동기화 암호" />
            <button className="btn-ghost" onClick={() => setShowPass(!showPass)}>{showPass ? "숨기기" : "보기"}</button>
          </div>
          <p className="hint">비공개 Gist도 주소를 아는 사람은 볼 수 있으므로 암호를 정하는 것을 권장합니다. 암호를 잊으면 Gist의 데이터는 풀 수 없습니다(각 기기의 데이터는 그대로 남습니다).</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> 자동 동기화 (앱을 열 때, 수정 후 잠시 뒤, 다시 돌아왔을 때)</label>
          <button className="btn-primary" disabled={!token || sync.running} onClick={() => void connectSync({ token, passphrase: pass, auto }).then((ok) => ok && (setToken(""), setPass("")))}>
            {sync.running ? "연결하는 중…" : "연결하고 동기화"}
          </button>
        </>
      ) : (
        <>
          <div className="space-y-1 text-sm">
            <div>
              ✅ <b>{sync.login}</b> 계정에 연결됨 {sync.encrypted ? "· 🔒 암호화" : "· ⚠️ 암호화 안 함"}
              {sync.gistUrl && <> · <a className="text-violet-600 underline" href={sync.gistUrl} target="_blank" rel="noreferrer">Gist 보기</a></>}
            </div>
            <div className="hint">
              {sync.running ? "동기화하는 중…" : sync.lastSyncAt ? `마지막 동기화 ${new Date(sync.lastSyncAt).toLocaleString("ko-KR")}${sync.lastResult ? ` (${sync.lastResult})` : ""}` : "아직 동기화하지 않았습니다."}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={sync.running} onClick={() => void syncNow()}>🔄 지금 동기화</button>
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={sync.auto} onChange={(e) => void updateSyncOptions({ auto: e.target.checked })} /> 자동</label>
            <button className="btn-danger ml-auto" onClick={() => confirm("이 기기의 동기화 연결을 해제할까요? 데이터와 Gist는 지워지지 않습니다.") && void disconnectSync()}>연결 해제</button>
          </div>
          {passError && (
            <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
              <div className="flex gap-2">
                <input className="input" type="password" placeholder="동기화 암호 다시 입력" value={pass} onChange={(e) => setPass(e.target.value)} aria-label="동기화 암호 다시 입력" />
                <button className="btn-primary shrink-0" onClick={() => void updateSyncOptions({ passphrase: pass }).then(() => syncNow())}>적용</button>
              </div>
              <button className="text-xs text-rose-600 underline" onClick={() => confirm("Gist에 있는 동기화 데이터를 무시하고 이 기기의 데이터(와 현재 암호)로 덮어쓸까요?\n다른 기기에서만 만든 내용은 Gist 수정 기록에만 남습니다.") && void syncNow({ forcePush: true })}>암호를 잊었습니다 → 이 기기 데이터로 Gist 덮어쓰기</button>
            </div>
          )}
        </>
      )}
      {sync.error && <p className="break-words text-sm font-semibold text-rose-600">❌ {sync.error}</p>}
      <p className="hint">같은 이야기를 두 기기에서 동시에 고치면 나중에 저장된 쪽이 남습니다. 한 기기에서 쓰고 동기화한 뒤 다른 기기에서 이어 쓰세요.</p>
    </div>
  );
}
