# 실행 가이드 — macOS (Windows와 다른 점만)

기준 문서는 [windows.md](windows.md)다. 순서(1 준비물 → 2 받기 → 3 설정 → 4 DB → 5 로그인 → 6 기동 → 7 테스트)와 `pnpm …` 명령은 **그대로** 쓰고, 아래 차이만 바꿔 읽는다. 셸은 zsh(기본 터미널) 기준이다.

## 1. 사전 준비물

| 준비물 | 설치 |
|---|---|
| Git | Xcode 명령행 도구(`xcode-select --install`) 또는 `brew install git` |
| Node.js 22 | 버전 관리자 하나: [mise](https://mise.jdx.dev/) `mise use node@22`(저장소의 `mise.toml`을 읽음) · nvm `nvm install 22 && nvm use 22`(`.nvmrc`) · 또는 `brew install node@22` |
| pnpm 10 | `corepack enable` (Windows와 같음) 또는 `npm install -g pnpm@10` |
| PostgreSQL 16 (직접 설치 경로) | `brew install postgresql@16` → `brew services start postgresql@16`. 슈퍼유저는 설치한 macOS 사용자다 |
| Docker | Docker Desktop 또는 [OrbStack](https://orbstack.dev/) (`brew install --cask orbstack`). compose 파일은 표준 기능만 써서 둘 다 된다 |

설치 확인은 Windows와 같다(`git --version`, `node --version`, `pnpm --version`, `docker compose version`).
mise를 쓰는데 `node --version`이 22가 아니면 저장소 폴더 안에서 실행 중인지 확인하거나 `mise exec -- pnpm …`으로 실행한다.

## 2. 저장소 받기

- `core.autocrlf`는 macOS 기본값(설정 없음)이면 된다. 설정돼 있다면 `git config --global core.autocrlf input` 또는 `false`.
- 긴 경로 설정은 필요 없다.
- macOS 파일 시스템은 기본적으로 **대소문자를 구분하지 않는다** — import 경로의 대소문자가 틀려도 여기서는 동작하고 CI(Linux)에서 깨진다. 파일명 대소문자는 [git-policy.md](../git-policy.md) §4를 따른다.

## 3. 초기 설정

`Copy-Item .env.example .env` 대신 `cp .env.example .env` (또는 그대로 `pnpm setup:env`).

## 4. DB 셋업 — (b) 직접 설치

Homebrew PostgreSQL은 슈퍼유저가 macOS 사용자라 `-U postgres`와 비밀번호가 필요 없다:

```bash
psql -d postgres -c "CREATE USER mes WITH PASSWORD 'dev-postgres-password' CREATEDB;"
psql -d postgres -c "CREATE DATABASE mes_hub OWNER mes;"
```

`psql`을 못 찾으면 `export PATH="$(brew --prefix postgresql@16)/bin:$PATH"` (`~/.zshrc`에 추가).

## 5–7. 로그인·기동·테스트

Windows와 같다. `pnpm dev` → http://localhost:5173 → 회원가입(예: `dev-owner`) → 빈 허브.

## 8. 운영 배포

운영 대상은 Windows다([windows.md §8](windows.md)). macOS는 개발용으로만 쓴다.

## 9. 문제 해결 (macOS 차이)

| 증상 | 해결 |
|---|---|
| 포트 충돌 | `lsof -i :5173` → `kill <PID>` |
| 5432 충돌(Homebrew PostgreSQL과 Docker PostgreSQL) | 한쪽만 쓴다 — `brew services stop postgresql@16` 또는 `.env`의 `POSTGRES_PORT=5433`·`DATABASE_URL` 포트 변경 |
| `docker: command not found` | Docker Desktop/OrbStack 앱을 한 번 실행해 CLI를 설치 |
| Playwright 브라우저 없음 | `pnpm --filter @mes/e2e install:browsers` |
