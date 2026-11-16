# Novel Generator 작업 안내

## 변경 후에는 릴리스까지 한 번에 진행

앱 코드(`src/`, `public/`, 빌드 설정 등)를 바꾸면, 사용자에게 따로 묻지 않고 아래를 끝까지 진행한다.

1. 버전 올리기: `package.json`과 `package-lock.json`의 `version` (기능 추가는 minor, 버그 수정은 patch)
2. `CHANGELOG.md` 맨 위에 `## vX.Y.Z — YYYY-MM-DD` 항목 추가 (릴리스 노트로 그대로 쓰인다)
3. 확인: `npm run typecheck`, `npm test`, `npm run build`
4. 커밋 · 푸시 → `main`으로 PR 만들기
5. CI(`Typecheck, test & build`)가 통과하면 PR을 스쿼시 머지 (제목 끝에 `(#PR번호)`)
6. Release 워크플로우(`.github/workflows/release.yml`)를 `main`에서 실행 → `vX.Y.Z` 태그와 GitHub Release 생성, 이어서 Pages 배포가 자동으로 돈다
7. 릴리스(첨부 파일)와 Pages 배포 결과를 확인해 사용자에게 알린다

CI가 실패하면 머지하지 않고 원인을 고친 뒤 다시 진행한다.
앱에 들어가지 않는 변경(이 파일, README 등 문서만)은 PR · 머지까지만 하고 릴리스는 하지 않는다.
