import { isIOS, promptInstall, usePwa } from "../lib/pwa";

const SITE = "https://soulfactorx.github.io/novel-generator/";

export default function InstallSection() {
  const pwa = usePwa();
  const isFile = typeof location !== "undefined" && location.protocol === "file:";
  return (
    <div className="card space-y-2">
      <div className="font-bold">📲 앱으로 설치 · 오프라인</div>
      {pwa.installed ? (
        <p className="text-sm">✅ 앱으로 설치되어 실행 중입니다. 인터넷이 없어도 열 수 있습니다(글 생성에는 인터넷이 필요합니다).</p>
      ) : isFile ? (
        <p className="hint">
          지금은 내려받은 HTML 파일로 실행 중이라 앱 설치를 할 수 없습니다. <a className="text-violet-600 underline" href={SITE} target="_blank" rel="noreferrer">웹 주소</a>에서 열면 홈 화면에 설치할 수 있습니다. 파일과 웹 주소는 저장 공간이 따로라, 옮기려면 백업 파일이나 동기화를 사용하세요.
        </p>
      ) : (
        <>
          <p className="hint">홈 화면에 설치하면 일반 앱처럼 전체 화면으로 열리고, 인터넷이 없어도 앱과 저장된 글을 볼 수 있습니다.</p>
          {pwa.canInstall ? (
            <button className="btn-primary" onClick={() => void promptInstall()}>📲 앱 설치</button>
          ) : isIOS() ? (
            <p className="text-sm">iPhone·iPad: Safari 아래쪽 <b>공유 버튼(□↑)</b> → <b>홈 화면에 추가</b>를 누르세요.</p>
          ) : (
            <p className="text-sm">브라우저 메뉴(⋮)에서 <b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 누르세요.</p>
          )}
          {pwa.swActive && <p className="hint">오프라인 실행 준비 완료</p>}
        </>
      )}
    </div>
  );
}
