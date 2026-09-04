# CLAUDE.md

NTMS — 통합 연계 운송관리시스템. 화주의 운송 오더를 받아 트립으로 묶고,
운송사·차량을 붙이고, 실행을 관제하고, 실적을 확정해 매출·매입을 정산하기까지.
pnpm 모노레포 · NestJS(REST) · Next.js · PostgreSQL 18 + Prisma.

**작업을 시작하기 전에 [`docs/handoff.md`](docs/handoff.md) 를 읽는다.** 어디까지
됐는지, 왜 그렇게 했는지, 무엇을 밟았는지가 거기 있다. 문서 배치는
[`docs/README.md`](docs/README.md) 의 라우팅 테이블을 본다.

이 파일에는 **매번 다시 알아내야 하는 것과 틀리기 쉬운 것**만 적는다.

---

## 명령

```bash
pnpm dev          # api :4000 + web :3000
pnpm typecheck    # 6/6. 테스트 파일까지 본다 — 이 저장소의 주 검증 수단
pnpm test         # 125개 (shared 93 · api 32)
pnpm build        # 4/4

pnpm --filter @ntms/api seed              # 기준정보 (권한·역할·메뉴·테넌트·공통코드)
pnpm --filter @ntms/api seed:demo -- --reset   # 데모 운영 데이터
pnpm db:pull      # DDL 을 고쳤으면 Prisma 모델을 다시 당긴다
```

`pnpm lint` 은 `apps/web` 에서 실패한다 — eslint 설정 파일이 아예 없다.
**기존 상태이고 코드 문제가 아니다.** 고치려 들지 말 것.

---

## 절대 어기면 안 되는 것

### RLS — 모든 DB 접근은 `prisma.run()` 안에서

```ts
await this.prisma.run({ tenantId, userId }, async (tx) => { ... });
```

밖에서 부르면 **오류가 아니라 0행**이다. 안전한 기본값이라 조용히 틀린다.
psql 로 확인할 때는 `ADMIN_DATABASE_URL`(BYPASSRLS)을 쓴다 — `DATABASE_URL`
(ntms_app)로 붙으면 역시 0행이 나온다. **앱은 절대 ADMIN 을 쓰지 않는다.**

### `date` 컬럼에는 UTC 자정만 넣는다

로컬 자정으로 만든 Date 는 KST(+9)에서 전날 15시 UTC 가 되어 **하루 앞당겨**
저장된다. `new Date().toISOString().slice(0, 10)` 도 UTC 날짜라 KST 오전 9시
전에는 **어제**가 나온다.

이 계열 버그는 **화면이 멀쩡히 그려져서 안 보인다.** 틀린 날의 데이터가 정상으로
나올 뿐이다. 실제로 배차판이 하루 전 데이터를 보여준 적도, 세금계산서 발행일이
하루 앞당겨 저장된 적도 있다.

`settlement-util.ts` 의 `dateOnly()` · `isoDate()` 를 쓰고, 화면의 "오늘"
기본값은 로컬 날짜를 따로 만든다. `apps/api/test/settlement-util.test.ts` 가
이 규칙을 지킨다.

### 판정 로직은 `packages/shared` 에 둔다

관문·계산·집계는 **화면과 서버가 같은 함수를 부른다.**

| 함수 | 무엇 |
|---|---|
| `calculateRate()` | 요율표로 금액을 만든다 |
| `evaluateConfirmGate()` | 실적을 확정해도 되는가 |
| `evaluateSettlementGate()` / `evaluateCloseGate()` | 정산·마감 관문 |
| `buildCashLadder()` | 정산 화면의 축 |

한쪽에만 넣으면 "저장은 됐는데 다음 단계가 안 된다" 가 된다. 서버가 한 번 더
부르는 것은 화면을 안 믿어서가 아니라, 판정과 실행 사이에 상태가 바뀔 수 있어서다.

### 권한 가드는 실제로 집행되어야 한다

`@Roles()` 데코레이터만 붙이는 것으로는 **아무 효력이 없다.** `RolesGuard` 가
그것을 읽는다. 역할은 액세스 토큰에서 오고 수명이 15분이라, 역할을 회수해도
최대 15분은 남는다. **되돌릴 수 없는 동작**(정산 승인·계정 삭제)은 가드만 믿지
말고 서비스에서 DB 의 현재 역할을 다시 본다.

### 시드는 앱의 함수를 그대로 부른다

`rebuildAggregates()` · `SettlementService` 를 시드가 직접 호출한다. 시드가 자기
계산을 따로 가지면 데모의 숫자와 화면에서 「다시 집계」를 누른 뒤의 숫자가
갈라지고, 그때 사람이 의심하는 것은 시드가 아니라 **화면**이다.

---

## 이 저장소의 관습

- **주석은 한국어로, "왜" 와 "안 그러면 무슨 일이 나는가" 를 적는다.** "무엇"은
  코드가 이미 말한다. 기존 주석의 밀도와 어조를 그대로 따른다.
- **커밋 메시지 본문을 길게 쓴다.** 이 저장소는 ADR 대신 커밋 메시지가 결정
  기록 역할을 한다. `git log --format='%h %s%n%n%b' -12` 로 흐름이 읽힌다.
- **테스트는 `test/` 에 둔다.** `src/` 안에 두면 빌드 tsconfig 가 그대로 dist 로
  내보낸다. 대신 빌드용 설정은 test 를 안 보므로 패키지마다 `tsconfig.test.json`
  이 따로 있고 `typecheck` 가 두 번 돈다.
- **테스트는 판정 로직과 순수 함수에만 있다.** 컨트롤러·서비스·화면에는 없다.
  의도한 선이다 — 실제로 난 사고가 전부 판정 로직에 있었다.
- **DB 가 진실을 들고 있다.** enum·제약·트리거는 DDL 이 원본이다. TypeScript 를
  `as never` 로 달래면 컴파일은 통과하고 **런타임에 Prisma 가 거절**한다.
  `psql -c "select unnest(enum_range(NULL::ntms.타입))"` 로 먼저 볼 것.

---

## 시간을 잃기 쉬운 곳

| 증상 | 원인 · 조치 |
|---|---|
| `pnpm dev` 가 `EADDRINUSE :::3000` | 앞서 띄운 dev 서버가 살아 있다. 포트 소유자만 골라 끝낸다(`Get-NetTCPConnection -LocalPort 3000`). **`Stop-Process -Name node` 금지** — 편집기 언어 서버까지 죽는다 |
| 그 프로세스가 `액세스가 거부되었습니다` | 지금 셸보다 높은 권한으로 떠 있다. 관리자 PowerShell 이 필요하다 |
| psql 조회가 0행 | `DATABASE_URL`(ntms_app)로 붙었다. `ADMIN_DATABASE_URL` 을 쓴다 |
| 로그인이 갑자기 429 | `/auth/login` 은 **IP당 5분 10회**다. 검증용 토큰은 한 번 받아 재사용한다 |
| nginx 로그를 grep 했더니 안 끝난다 | `access.log` 는 `/dev/stdout` 심볼릭 링크다. **Loki 에 묻는다** (`{container="ntms-nginx"}`) |
| `EPERM ... query_engine-windows.dll.node` | API 가 뜬 채로 빌드했다 |
| 화면이 한산하다 | 데모 트립 시각이 **실행 시점 기준**이다. `seed:demo -- --reset` 을 다시 |
| `curl -o /tmp/x` 가 엉뚱한 데로 | Windows 바이너리라 `C:\tmp\x` 로 간다. Git Bash 의 `/tmp` 와 다르다 |

---

## 구조

```
apps/api        NestJS :4000   도메인 모듈 = auth dashboard master order plan
                               dispatch execution actual settlement system naver
apps/web        Next.js :3000  App Router. 브라우저는 언제나 같은 출처의 /api 를
                               부른다 (api-client.ts 의 BASE = '/api' — 상대경로)
packages/shared 판정·계산·타입 (화면과 서버가 같이 쓴다)
packages/db     Prisma 스키마 · 테넌트 컨텍스트(withTenant)
db/             DDL 원본 · 마이그레이션          docker/  가동계 배포 · 모니터링
```

가동계는 `http://www.qqq.ai.kr` (apex 는 www 로 301, 공인 IP 도 열려 있다).
배포·모니터링 절차는 `docs/` 의 operations 폴더에 있다.
