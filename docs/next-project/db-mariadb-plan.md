# DB 엔진 전환 계획 — PostgreSQL → MariaDB

> **상태: 완료(2026-10-01)** — G1–G5 통과, `main` 병합(`1eb0335`), 태그 `db-mariadb-done`. 되돌림 기준점 `pre-mariadb`. §3 매핑 규칙은 이후 DB 작업의 정본으로 계속 쓴다.

- 결정: DB 엔진을 **MariaDB 단독 설치**로 바꾼다(사용자 결정, 2026-09-30). 기준 버전 **11.8 LTS**, 호환 하한 10.4(검수 때 1회 확인).
- 방식: **이관**. 기존 테스트를 기준으로 DB 계층만 다시 맞춘다. 웹·`packages/*`·API 계약·E2E 시나리오는 바꾸지 않는다.
- 브랜치: `feat/db-mariadb`(전환 전용). `main`은 병합 전까지 PostgreSQL로 동작한다. 두 DB 동시 지원은 하지 않는다.
- 옮길 데이터 없음: 운영 데이터가 아직 없으므로 기존 마이그레이션(0000–0003)은 버리고 MariaDB용 초기 1개를 새로 만든다.

## 1. 범위

| 바뀜 | 안 바뀜 |
|---|---|
| `apps/api`의 DB 계층: `db/*`, 서비스 7개(`users`·`session`·`catalog`·`tasks`·`files`·`dbLlmPorts`·`requests`), `health`, DB 통합 테스트 | `apps/web`, `packages/domain`·`llm`·`contracts`, `e2e` 시나리오 |
| `docker-compose.yml`, `.env.example`, CI(`db`·`setup-guide`·`e2e` 잡), 설치 가이드, 스택 문서 | `openapi.yaml`, 데이터 계약의 의미(테이블·컬럼·제약) |

## 2. 단계와 검수 관문

각 단계는 관문을 통과해야 다음으로 간다. 관문 결과는 태스크 로그에 남긴다.

| 단계 | 내용 | 검수 관문 |
|---|---|---|
| 0 준비 | 브랜치, compose에 `mariadb`(11.8), 테스트용 임시 DB 권한, `.env.example` | 컨테이너 healthy, 앱 계정으로 임시 DB 생성·삭제 |
| 1 기반 | 드라이버·연결, 스키마, 초기 마이그레이션, `migrate`·`seed`·임시 DB 도구·`health`, 로그인(사용자·세션), 카탈로그 | **G1**: 해당 DB 테스트·단위 테스트 통과, 스키마↔마이그레이션 일치, **구조 대조**(3.6), 스키마 리뷰 반영 |
| 2 서비스 | 대화 → 파일 → LLM 포트 → 요청 서비스 | **G2**: typecheck·lint·단위·DB 테스트 전부 통과, 동시성 테스트 반복 실행에서 무작위 실패 0, 10.4에서도 통과 |
| 3 전 구간 | E2E(mock·live) | **G3**: 기존 시나리오 전부 통과 |
| 4 주변 | CI, 설치 가이드(Windows·macOS), README·architecture·HANDOFF(결정 기록)·CLAUDE.md, compose·의존성에서 PostgreSQL 제거 | **G4**: CI 전 잡 녹색(ubuntu·windows, 설치 가이드 잡 포함) |
| 5 마감 | 코드 리뷰 → 반영 → 병합 | **G5**: 리뷰 지적 반영, 사용자 승인 후 `main` 병합(`--no-ff`) |

검수 공통 기준
- 기존 테스트의 단언을 약화·삭제하지 않는다. 방언 때문에 성립하지 않는 테스트(3.6)만 대체하고 근거를 남긴다.
- 대응표(`parity-matrix.md`)의 ✅ 항목에 회귀가 없어야 한다.
- 동시성 불변식 네 가지를 병렬 테스트로 확인한다: 대화당 진행 중 요청 1건, 업무 번호 중복 없음, 최초 System Owner 1회, 파일 버전 체인 유일성.

## 3. 매핑 규칙 (구현 기준)

### 3.1 드라이버·연결
- `mysql2`(순수 JS) + `drizzle-orm/mysql2`. `postgres` 패키지는 제거. `DATABASE_URL`은 `mysql://…`.
- 연결 옵션은 **한 곳**에서 만든다(앱·`migrate`·`seed`·테스트가 같은 함수를 쓴다).
- 연결마다 세션을 고정한다: 시간대 UTC, 격리 수준 `READ COMMITTED`, 엄격 모드(긴 값·잘못된 값은 절단하지 않고 오류). 서버 설정에 기대지 않는다.
- "갱신된 행 수"는 **조건에 맞은 행 수**여야 한다(값이 같아도 1). 테스트로 고정한다.
- DB 기본 문자셋·정렬은 `utf8mb4`·`utf8mb4_nopad_bin`(대소문자·끝 공백까지 그대로 비교 — PostgreSQL과 같은 의미). `utf8mb4_bin`은 끝 공백을 무시하므로 쓰지 않는다. `migrate`는 다르면 적용을 거부한다.

### 3.2 타입
| PostgreSQL | MariaDB |
|---|---|
| `text`(PK·FK·유일·인덱스 대상) | `varchar(191)`. 예외: 파일 원래 이름 `varchar(255)`(서비스 허용 길이), SSO 식별자 `varchar(512)` |
| `text`(그 밖) | `text`, 본문류(메시지·프롬프트·추출문·오류)는 `longtext` |
| `timestamptz` | `datetime(6)`, UTC 저장, 기본값 `current_timestamp(6)` |
| `jsonb` | `json`. 서버 버전에 따라 문자열로 돌아오므로(10.4) 읽을 때 항상 객체로 바꾸는 컬럼 타입을 쓴다 |
| `boolean`·`integer`·`bigint`·`date`·`char` | 같은 이름 타입 |

### 3.3 제약·인덱스
- PK·FK·유일·check는 이름과 의미를 그대로 옮긴다.
- 조건부 유일 인덱스 2개(대화당 진행 중 요청 1건, 삭제되지 않은 파일 버전)는 **저장형 생성 컬럼 + 유일 인덱스**로 바꾼다(조건 밖이면 NULL → 유일성 미적용).
- 조건부 일반 인덱스는 일반 인덱스로.
- 길이 경계: 사용자 입력이 `varchar` 컬럼으로 가는 경로(태그, 멱등 키, SSO 식별자 등)는 API 경계에서 컬럼 길이로 검증하고 초과는 400으로 답한다. DB 오류(500)로 끝나지 않게 한다. 키가 아닌 파생 표시값은 `text`로 둔다.

### 3.4 구문
- `returning` → 결과의 행 수로 판정하거나, 같은 트랜잭션에서 다시 조회.
- `onConflictDoNothing` → 일반 insert + 중복 오류(1062) 처리, 또는 값이 변하지 않는 `on duplicate key update`. **`INSERT IGNORE` 금지**(다른 오류까지 삼킨다).
- `onConflictDoUpdate` → `on duplicate key update`. 유일 키가 여러 개인 테이블은 의도한 키 외의 충돌로 갱신되지 않는지 확인한다.
- 트랜잭션 범위 이름 잠금(5곳) → 이미 있는 행의 `for update`로 충분하면 그것을 쓴다. 잠글 행이 없을 때만 잠금 전용 테이블(`db_lock`)의 행을 upsert로 잠근다(트랜잭션 끝까지 유지). 연결 범위 잠금(`GET_LOCK`)은 쓰지 않는다.
  - `db_lock` 키는 `<이름공간>:<값>`. 값이 복합·가변 길이면 sha256 hex로 고정 길이화한다. 키 집합이 끝없이 늘어나는 용도에는 쓰지 않는다.
  - 잠금 순서: `db_lock` → 대화(task) → 스레드 → 요청. 같은 종류를 여러 개 잠글 때는 키·ID 오름차순.
- `for share`는 MariaDB 문법에 없다 → `lock in share mode` 또는 `for update`.
- 형 변환·부분 문자열 등 PostgreSQL 전용 표현은 표준 또는 MariaDB 표현으로.

### 3.5 오류
- 유일 위반: 오류 번호 1062(드라이버 오류가 감싸져 오면 원인까지 확인).
- 교착(1213)·잠금 대기 초과(1205): 발생 지점을 결과에 보고한다. 재시도는 DB 밖 부작용이 없는 트랜잭션에만 넣는다.

### 3.6 마이그레이션·스키마 테스트
- `drizzle.config` 방언을 바꾸고 초기 마이그레이션 1개를 생성한다.
- `schema-drift` 테스트(스키마 ↔ 마이그레이션)는 유지한다.
- `schema-parity` 테스트(초안 SQL ↔ 마이그레이션)는 초안이 PostgreSQL 전용이라 폐기한다. 대신
  - 저장소에는 **제약 동작 테스트**를 둔다: 진행 중 1건·파일 버전 유일성, check 위반, FK 위반, 대소문자가 다른 값의 유일성, 길이 초과 거부.
  - 검수(G1)에서 **구조 대조**를 1회 한다: 전환 전 PostgreSQL 스키마와 테이블·컬럼 이름·NULL 허용·PK·FK·유일·check 개수를 비교(생성 컬럼·잠금 테이블만 차이).
- 전환 뒤 DDL 정본은 Drizzle 스키마와 `apps/api/drizzle/`이다. `docs/architecture/postgres-draft.sql`은 4단계에서 "전환 전 기록"으로 표시한다.

### 3.7 호환 하한(10.4)에서 쓰지 않는 것
`FOR SHARE`, `SKIP LOCKED`, `INSERT … RETURNING`, `UPDATE … RETURNING`, `uca1400` 정렬, `UUID` 타입.

## 4. 위험과 대응
| 위험 | 대응 |
|---|---|
| 격리 수준·잠금 방식 차이로 경합 결과가 달라짐 | 세션 `READ COMMITTED` 고정, 잠금 순서(대화 → 스레드 → 요청) 유지, 동시성 테스트 반복 |
| 교착 시 DB가 한쪽 트랜잭션을 되돌림 | 잠금 순서 고정(3.4)으로 예방, 남는 지점은 부작용 없는 곳만 재시도 |
| 길이 제한이 새로 생김(`varchar`) | 키 성격 컬럼만 제한, 본문은 `text`·`longtext`, 초과는 절단 없이 오류 |
| DDL이 트랜잭션으로 묶이지 않음 | 초기 마이그레이션 1개로 시작, 이후 마이그레이션은 작게 |
| 브랜치 CI가 4단계 전까지 빨강 | 예상된 상태. 관문은 로컬 검증으로 판정하고 G4에서 CI를 맞춘다 |

## 5. 전환 뒤 작업
S3 ②(`s3-context`)·③(`s3-tray-events`)은 이 브랜치가 `main`에 병합된 뒤 그 위에서 진행한다.
