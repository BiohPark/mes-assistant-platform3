# git 관리 기준

이 저장소는 **GitHub 공개 저장소**이고, 최종 실행 환경은 **Windows**, 개발은 macOS·Windows 모두에서 한다.
아래 규칙은 사람과 AI 에이전트 모두에게 같다. 핵심 요약은 [CLAUDE.md](../CLAUDE.md) 프로젝트 블록 "git 관리 기준"에 있다.

## 1. 브랜치

- `main`은 **항상 동작하는 상태**다 — 받아서 [설치 가이드](setup/windows.md)대로 하면 로그인까지 된다.
- 작업은 목적별 브랜치에서 한다.

| 접두 | 용도 | 예 |
|---|---|---|
| `feat/*` | 기능 | `feat/s1-openwebui-proxy` |
| `fix/*` | 결함 수정 | `fix/login-callback-state` |
| `docs/*` | 문서만 | `docs/setup-windows` |
| `chore/*` | 설정·의존성·빌드 | `chore/bump-vite` |

- 스프린트가 끝나 `main`에 병합되면 태그를 단다: `s0-done`, `s1-done`, … (`git tag -a s0-done -m "S0 뼈대 완료"`).

## 2. 커밋

- **작은 단위, 한 커밋에 한 가지 목적.** 테스트와 그 테스트를 통과시키는 코드는 같은 커밋이어도 된다.
- 형식: [Conventional Commits](https://www.conventionalcommits.org/ko/v1.0.0/) 접두 + 요약.

| 접두 | 뜻 |
|---|---|
| `feat:` | 기능 추가 |
| `fix:` | 결함 수정 |
| `docs:` | 문서 |
| `test:` | 테스트만 |
| `refactor:` | 동작 변화 없는 구조 변경 |
| `chore:` | 설정·의존성·빌드·CI (`ci:`도 허용) |

- 범위를 붙여도 된다: `feat(api): …`, `fix(web): …`.
- 메시지 언어: 요약·본문 **한국어**(접두는 영어). _(사용자 결정 G2, 2026-09-28)_
- **`pnpm-lock.yaml`은 항상 커밋한다.** 의존성 추가·변경은 **별도 커밋**(`chore(deps): …`)으로 분리한다 — 기능 커밋과 섞지 않는다.

## 3. 병합 조건

`main`에 들어가려면 모두 충족해야 한다.

1. CI 녹색 — `ubuntu-latest`·`windows-latest`의 typecheck·lint·test, DB 통합, E2E
2. 로컬에서 관련 테스트 통과
3. **사용자 승인** — push와 `main` 병합은 사용자 확인 후에만 한다(AI 에이전트 포함)

병합 방식: **merge commit(`git merge --no-ff`)** — squash 하지 않는다. 테스트 먼저·작은 커밋 이력을 `main`에 그대로 보존하기 위해서다. 스프린트 완료 시 태그(§1). _(사용자 결정 G1, 2026-09-28)_
스프린트 브랜치는 PR로 올리고, PR 본문에 스프린트 완료 기준 확인 결과를 적는다.

## 4. 줄바꿈·크로스플랫폼

- `.gitattributes`가 줄바꿈을 정한다: `* text=auto eol=lf`, 이미지·글꼴은 `binary`. 저장소의 텍스트 파일은 모두 LF다.
- **Windows 사용자는 `core.autocrlf=false`** 를 권장한다(체크아웃 때 CRLF로 바꾸지 않게):
  ```powershell
  git config --global core.autocrlf false
  ```
  편집기는 LF로 저장하도록 둔다(VS Code: `"files.eol": "\n"`).
- 긴 경로: Windows에서 `node_modules` 경로가 260자를 넘을 수 있다 → `git config --global core.longpaths true` (설치 가이드 참고).
- **파일명 규칙**
  - import 경로의 대소문자는 실제 파일명과 **정확히** 같게 쓴다(macOS는 대소문자를 무시하지만 CI의 Linux는 구분한다). 대소문자만 바꾸는 이름 변경은 `git mv Foo.ts foo.ts`로 한다.
  - Windows 금지 문자 `< > : " / \ | ? *`, 끝의 공백·마침표, 예약어(`CON` `PRN` `AUX` `NUL` `COM1`–`COM9` `LPT1`–`LPT9`, 확장자가 붙어도 금지)를 파일·폴더 이름에 쓰지 않는다.
  - 사용자가 올린 파일의 원래 이름은 DB에만 두고, 디스크에는 `storage_key`(`/` 구분 상대 키)로 저장한다(`FileStorageService`).

## 5. 커밋 금지 대상

| 종류 | 예 | 막는 곳 |
|---|---|---|
| 비밀값 | `.env`, API 키, client secret, 토큰, 인증서 | `.gitignore`(`.env`) — 예시는 `.env.example`에 **가상 값**으로만 |
| 사내 정보 | 사내 주소·사내 AI 포털 주소·양식 번호·실명·사내 자료·참고 이미지와 거기서 옮긴 문구 | 사람 점검 + 아래 검사 |
| 로컬 산출물 | `node_modules/`, `dist/`, `.pnpm-store/`, `coverage/`, `*.log`, `test-results/`, `playwright-report/`, `storage/`, 스크린샷 | `.gitignore` |

시드·테스트 데이터는 가상 데이터(`dev-member`, `example.com` 등)만 쓴다.

## 6. 커밋 전 민감 문자열 점검

스테이징한 뒤(`git add`) 커밋 전에 실행한다. PowerShell·bash 모두 같은 명령이다.

```powershell
# 1) 비밀값 모양 (키·토큰·개인키)
git grep --cached -nIE "sk-[A-Za-z0-9]{20,}|api[_-]?key\s*[:=]\s*['\"]?[A-Za-z0-9_\-]{16,}|client[_-]?secret\s*[:=]\s*['\"]?[A-Za-z0-9_\-]{16,}|BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY"

# 2) 외부 주소 — localhost·example.com·공개 문서 외의 주소가 나오면 사내 주소인지 확인
git grep --cached -nIE "https?://[^ )'\"<>]+" -- apps packages e2e docker scripts .github "*.md" | Select-String -NotMatch "localhost|127\.0\.0\.1|example\.(com|org)|github\.com"

# 3) 스테이징된 파일 목록 — .env·이미지·로그가 섞이지 않았는지
git diff --cached --name-only
```

- bash에서는 2)의 `Select-String -NotMatch`를 `grep -vE`로 바꾼다.
- 결과가 나오면 커밋하지 않고 원인을 없앤다. 이미 커밋했다면 **push 전에** 커밋을 고친다(`git commit --amend` 또는 되돌리기). push한 뒤라면 비밀값은 **즉시 폐기·재발급**한다 — 공개 저장소 이력은 지워도 이미 복제됐을 수 있다.
- 선택: 비밀값 스캐너 [gitleaks](https://github.com/gitleaks/gitleaks)를 설치했다면 `gitleaks git --staged`로 한 번 더 본다.

## 7. 멀티에이전트 운영 파일

`CLAUDE.md`, `_shared/`, `_templates/`는 AI 오케스트레이션 규칙이다. 제품 코드가 아니다. **공개 저장소에 그대로 둔다** _(사용자 결정 G3, 2026-09-28 — 회사 민감 자료는 이미 제외)_. 봇 ID 같은 이 환경 고유 값은 `CLAUDE.local.md`(무시됨)에만 적는다.
작업 기록 `tasks/`, `_local/`, `threads/`는 추적하지 않는다(`.gitignore`).
