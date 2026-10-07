# 실행 가이드 — macOS (Windows와 다른 점만)

기준 문서는 [windows.md](windows.md)다. 순서(1 준비물 → 2 받기 → 3 설정 → 4 DB → 5 로그인 → 6 기동 → 7 테스트)와 `pnpm …` 명령은 **그대로** 쓰고, 아래 차이만 바꿔 읽는다. 셸은 zsh(기본 터미널) 기준이다.

## 1. 사전 준비물

| 준비물 | 설치 |
|---|---|
| Git | Xcode 명령행 도구(`xcode-select --install`) 또는 `brew install git` |
| Node.js 22 | 버전 관리자 하나: [mise](https://mise.jdx.dev/) `mise use node@22`(저장소의 `mise.toml`을 읽음) · nvm `nvm install 22 && nvm use 22`(`.nvmrc`) · 또는 `brew install node@22` |
| pnpm 10 | `corepack enable` (Windows와 같음) 또는 `npm install -g pnpm@10` |
| MariaDB 11.8 (직접 설치 경로) | `brew install mariadb@11.8` → `brew services start mariadb@11.8`. 설치한 macOS 사용자가 비밀번호 없이 관리자로 접속한다 |
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

Homebrew MariaDB는 macOS 사용자가 관리자라 `-u root`와 비밀번호가 필요 없다(이 경로는 CI가 검증하지 않는다):

```bash
mariadb -e "CREATE DATABASE mes_hub CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin;"
mariadb -e "CREATE USER 'mes'@'localhost' IDENTIFIED BY 'dev-mariadb-password', 'mes'@'%' IDENTIFIED BY 'dev-mariadb-password';"
mariadb -e "GRANT ALL PRIVILEGES ON mes_hub.* TO 'mes'@'localhost', 'mes'@'%';"
mariadb -e "GRANT ALL PRIVILEGES ON \`t\\_%\`.* TO 'mes'@'localhost', 'mes'@'%';"
```

`mariadb`를 못 찾으면 `export PATH="$(brew --prefix mariadb@11.8)/bin:$PATH"` (`~/.zshrc`에 추가).

## 5–7. 로그인·기동·테스트

Windows와 같다. `pnpm dev` → http://localhost:5173 → 회원가입(예: `dev-owner`) → 빈 허브.

## 8. 운영 배포

운영 대상은 Windows다([windows.md §8](windows.md)). macOS는 개발용으로만 쓴다.
배포 묶음 생성은 저장소 루트에서 `pnpm release`로 하고, 로컬 운영 HOME 테스트는 `pnpm deploy:local -- --home /absolute/path/mes-hub --init --no-service`로 한다.
데모 bundle은 `mise exec -- pnpm db:import /path/to/bundle.json --dry-run --default-owner <loginId>`로 먼저 확인한다. 소유자가 빈 행이 있으면 `--default-owner`에 기존 또는 함께 가져올 사용자의 로그인 ID를 지정한다. 기본 크기 제한은 64 MiB다. macOS/Node 22에서 60 MiB bundle의 최대 RSS는 382 MiB였으므로 이관 프로세스에 최소 512 MiB의 여유 메모리를 둔다. 다중 SR 업무는 기본적으로 중단하며, 연결 손실을 수용할 때만 `--allow-multi-sr`를 추가한다.

## 9. 문제 해결 (macOS 차이)

| 증상 | 해결 |
|---|---|
| 포트 충돌 | `lsof -i :5173` → `kill <PID>` |
| 3306 충돌(Homebrew MariaDB·MySQL과 Docker MariaDB) | 한쪽만 쓴다 — `brew services stop mariadb@11.8` 또는 `.env`의 `MARIADB_PORT=3307`·`DATABASE_URL` 포트 변경 |
| `docker: command not found` | Docker Desktop/OrbStack 앱을 한 번 실행해 CLI를 설치 |
| Playwright 브라우저 없음 | `pnpm --filter @mes/e2e install:browsers` |
