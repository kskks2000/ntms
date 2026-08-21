# NTMS 인수인계

이 문서는 **다음 사람(또는 다음 세션)이 이어서 개발할 수 있게** 쓴 것이다.
스키마는 `db/README.md`, 원격 배포는 `docker/README.md`, 디자인 언어는
`docs/design-system.md` 에 있으므로 여기서는 링크만 걸고 **그 문서들에 없는
것** — 지금까지 내린 판단과 그 이유, 밟았던 지뢰 — 을 적는다.

마지막 갱신: 2026-08-21 (커밋 `30d1656` 시스템관리)

---

## 1. 이 시스템이 무엇인가

**NTMS — 통합 연계 운송관리시스템.** 대기업이 쓰는 엔터프라이즈급 TMS.
화주의 운송 오더를 받아 트립으로 묶고, 운송사와 차량을 붙이고, 실제 운행을
관제하고, 실적을 확정해 매출·매입을 정산하기까지가 범위다.

```
오더 접수 → 편성 → 배정 → 배차 → 실행·트래킹 → 실적 확정 → 정산
   ✅        ✅     ✅     ✅        ✅            ✅         ⬜
```

곁들여 시스템관리(사용자·권한 · 공통코드 · 감사로그)도 서 있다. 파이프라인
바깥이지만 대기업 도입에서 먼저 묻는 것이 계정과 감사라 같이 만들었다.

---

## 2. 지금 어디까지 됐나

### 완성된 화면

| 경로 | 화면 | 시그니처 |
|---|---|---|
| `/login` `/signup` `/password/*` | 인증 | — |
| `/dashboard` | 관제 현황 | 축 위로 흐르고 축 아래로 쌓인다 (파이프라인) |
| `/master/*` (8개) | 기준정보 | 남은 날을 막대 길이로 (ValidityMeter) |
| `/plan/orders` `/new` `/[id]` `/edit` | 오더 관리·등록·상세 | 두 창 사이에 소요시간이 들어가는가 (TimeSpine) |
| `/plan/consolidation` | 편성 · 상차조합 | 정차 순서를 따라가며 천장을 넘는가 (LoadProfile) |
| `/plan/allocations` | 운송사 배정 | 후보 운송사 단가 비교 |
| `/plan/dispatch` | 배차판 | 계획 막대 위에 실적을 겹친다 (간트) |
| `/execution/control` | 실시간 관제 | **지연 전파 축** |
| `/execution/tracking` | 실시간 추적 | 번호 하나로 찾는다 |
| `/execution/exceptions` | 운송 예외 | 건수가 아니라 까먹은 시간 |
| `/execution/pod` | 인수증(POD) | 쌓인 서류가 아니라 빠진 서류 |
| `/actuals` `/[id]` | 운송실적 · 상세 | **편차 축** (VarianceSpine) · 확정 관문 |
| `/actuals/daily` | 운행일보 | 차량마다 하루를 띠로 (DayBand) |
| `/actuals/kpi` | KPI 현황 | 점이 아니라 선 (KpiStrip) |
| `/system/users` | 사용자 · 권한 | **권한 격자** — 오른쪽이 위험하다 (ReachGrid) |
| `/system/codes` | 공통코드 | 끄면 무엇이 사라지나 — 드롭다운 미리보기 |
| `/system/audit` | 감사로그 | **변경 축** — 바뀐 칸만 (DiffSpine) |

### 남은 범위

**매출/매입 정산** — 메뉴 `/settlements/billing`, `/payment`, `/invoices`, `/close`.
파이프라인의 마지막 칸이고, 이것을 채우면 오더에서 돈까지가 닫힌다.
자세한 것은 10절.

미구현 메뉴를 누르면 `apps/web/src/app/(app)/[...slug]` 가 "준비 중" 화면을 낸다.

### 손 안 댄 채 적어만 둔 것

- 거점 좌표 일괄 지오코딩 버튼 (`/naver/geocode` 창구는 이미 있다)
- 운송사 포털 (운송사가 직접 배차 수락·실적 입력)
- 오더 예상 운임 계산 (요율표는 이미 있다 — 정산의 `calculateRate()` 를 만들면
  그대로 쓸 수 있다)
- 오더 목록 내려받기(엑셀)
- 부대비 유형(`surcharge_type`) 관리 화면 — 지금은 시드로만 채운다
- 역할 편집 화면 — 역할은 시드가 만들고 화면은 읽기만 한다
- 세금계산서 국세청 실연동 (`tax_invoice.nts_*` 칸은 있으나 전송은 안 붙였다)
- HTTPS — 사용자가 "나중에 계획 생기면 그때" 라고 했다

---

## 3. 구조

```
apps/api      NestJS 11  :4000   도메인 모듈 = auth dashboard dispatch master
                                     order plan execution actual system naver
apps/web      Next.js 15 :3000   App Router · React 19
packages/shared  zod 3            타입 + **화면과 서버가 같이 쓰는 판정 함수**
packages/db      Prisma 6         db pull 로 생성. 스키마는 SQL 이 원본이다
db/              SQL 원본 (db/ddl/*.sql) · 마이그레이션 (db/migrate.sh)
docker/          가동계 배포
```

### `packages/shared` 에 판정 로직을 두는 이유

칸 하나하나는 정상인데 **값들 사이의 관계**가 성립하지 않는 경우가 이 도메인에
흔하다 — 상차 마감 14:00 · 하차 마감 15:00 · 구간 5시간. 화면과 서버가 서로
다른 판정을 하면 "저장은 됐는데 편성이 안 된다" 가 되므로, 판정 함수를 한 곳에
두고 양쪽이 부른다.

| 파일 | 핵심 함수 |
|---|---|
| `order-detail.ts` | `evaluateSpine()` — 시간창이 성립하는가 |
| `plan.ts` | `buildLoadProfile()` `deriveStops()` `checkPrecedence()` |
| `execution.ts` | `buildCascade()` — 지연이 뒤로 어떻게 번지나 |
| `actual.ts` | `evaluateConfirmGate()` — 정산에 넘겨도 되는가 · `buildVariance()` |
| `system.ts` | `buildReachGrid()` — 권한이 어디까지 닿나 · `diffSnapshot()` · `buildCodePreview()` |

---

## 4. 절대 어기면 안 되는 것

### RLS 멀티테넌시

모든 조회·쓰기는 `prisma.run({ tenantId, userId }, fn)` 안에서 돈다. 이것이
`SET LOCAL app.tenant_id` 를 걸고, DB 의 RLS 정책이 다른 테넌트 행을 아예 안
보여준다. **`run()` 밖에서 prisma 를 직접 부르면 조용히 0행이 나온다** — 오류가
아니라 빈 결과라서 화면은 멀쩡히 그려진다. 로컬에서 psql 로 확인할 때도
`DATABASE_URL`(ntms_app) 로 붙으면 0행이 나오므로 `ADMIN_DATABASE_URL` 을 쓴다.

```
ntms_app    RLS 적용   앱이 상시 쓰는 역할
ntms_admin  BYPASSRLS  시드·점검 전용. 앱 컨테이너에 절대 넣지 않는다
```

### DB 가 진실을 들고 있다

앱에서 중복으로 하지 말 것:

| 트리거 · 함수 | 하는 일 |
|---|---|
| `trg_transport_order_status_log` | 오더 상태가 바뀌면 이력을 **자동으로** 넣는다 |
| `fn_validate_order_status` | `order_status_rule` 표에 없는 전이를 막는다 |
| `fn_next_no` | `numbering_rule` 로 채번한다 |

오더 상태는 **한 칸씩만** 넘어간다. `RECEIVED → PLANNED` 는 규칙이 막으므로
`plan.service.ts` 의 `advanceOrders()` 가 `ORDER_FLOW` 를 따라 두 번 밟는다.

### 권한 가드는 실제로 집행되어야 한다

`@Roles('ADMIN')` 은 데코레이터일 뿐이고, 그것을 읽는 `RolesGuard` 가
`AuthModule` 에 `APP_GUARD` 로 등록되어 있어야 효력이 생긴다. 순서도 중요하다 —
`JwtAuthGuard` 다음에 와야 `req.user` 가 채워져 있다.

가드 없이 데코레이터만 붙은 상태는 **조용히 열린 문**이다. 붙인 쪽은 잠갔다고
믿고, 실제로는 로그인한 누구나 들어온다. 오류가 안 나므로 아무도 눈치 못 챈다.
시스템관리를 만들 때 이 상태를 발견해서 가드를 채워 넣었다.

역할은 액세스 토큰(`rol`)에서 온다. 토큰 수명이 15분이라 역할을 회수해도 최대
15분은 남는다. **되돌릴 수 없는 동작**(정산 승인 · 계정 삭제)은 가드만 믿지
말고 서비스에서 DB 의 현재 역할을 다시 볼 것.

### 날짜 · 시각

- `date` 컬럼에 넣을 값은 반드시 **UTC 자정**으로 만든다. 로컬 자정으로 만든
  Date 는 KST(+9)에서 전날 15시 UTC 가 되고 Postgres 가 하루 앞당겨 저장한다.
  `seed-demo.ts` 의 `dateOnly()`, `execution.service.ts` 의 `dateOnly()` 참고.
- 이 계열 버그는 **화면이 멀쩡히 그려져서** 안 보인다. 틀린 날의 데이터가
  정상으로 나올 뿐이다. 배차판이 하루 전 데이터를 보여주던 사고가 그것이었다.

### 비밀

- 서버 비밀은 `/opt/ntms/.env` (mode 600). 저장소에 넣지 않는다.
- `POSTGRES_PASSWORD` 는 로컬(12자)과 서버(48자 hex)가 **일부러 다르다.**
  DB 도구가 실수로 가동계를 건드리는 것을 막는 안전장치다 — 같게 만들지 말 것.
- 네이버 **Client Secret 은 서버 전용**. 브라우저로 나가는 건 Client ID 뿐이고,
  그건 NCP 콘솔의 도메인 등록으로 보호한다.

---

## 5. 로컬에서 띄우기

전제: Node 24+ · pnpm 10+ · PostgreSQL 18 · 루트에 `.env`

```bash
pnpm install
pnpm db:create
PGCLIENTENCODING=UTF8 pnpm db:ddl          # Windows 는 인코딩 고정 필수
MIGRATE_TARGET=native bash db/migrate.sh
pnpm db:pull                                # Prisma 모델 · 클라이언트
pnpm --filter @ntms/api seed                # 권한 · 역할 · 메뉴 · 테넌트 · 관리자 · 공통코드
pnpm --filter @ntms/api seed:demo -- --reset  # 데모 운영 데이터 + 데모 계정 18명
pnpm dev                                    # api :4000 + web :3000
```

`http://localhost:3000/login` → `NTMS` / `admin` / `Ntms@2026!log`

데모 계정 18명(`jhkim` `sylee` `bwoh` …)의 비밀번호는 `DEMO_USER_PASSWORD`
환경변수로 정하고, 안 주면 로컬 기본값을 쓴다. **가동계에서는 반드시 넣는다**
— 안 넣으면 저장소에 적힌 비밀번호 계정이 열여덟 개 생긴다. 6절 참고.

### 자주 밟는 것

| 증상 | 원인 · 조치 |
|---|---|
| `EPERM ... query_engine-windows.dll.node` | API 가 뜬 채로 빌드했다. 3000·4000 포트의 node 를 죽이고 다시 |
| `pnpm lint` 에서 web 실패 | `apps/web` 에 eslint 설정 파일이 아예 없다. `next lint` 가 대화형 설정을 물어보는 것 — **기존 상태이고 코드 문제가 아니다** |
| psql 로 조회했는데 0행 | `DATABASE_URL`(ntms_app)로 붙었다. `ADMIN_DATABASE_URL` 을 쓸 것 |
| 화면이 한산하다 | 데모 트립 시각이 **실행 시점 기준**이다. `seed:demo -- --reset` 을 다시 돌린다 |
| 로그인이 갑자기 안 된다 | `/auth/login` 은 **IP당 5분에 10회**다(`auth.controller.ts`). API 를 검증하며 curl 로 여러 번 부르면 브라우저 몫까지 쓴다. 한도를 낮추지 말고 API 를 재기동해 카운터를 비운다 |
| 공통코드 화면이 비었다 | `seed`(demo 아님)를 안 돌렸다. 코드 그룹은 기준정보라 `seed.ts` 에 있다 |

---

## 6. 가동계

- VM `175.45.193.174` · 도메인 `www.qqq.ai.kr` (apex `qqq.ai.kr` 도 여기)
- nginx :80 만. HTTPS 없음 → `COOKIE_SECURE=false` (임시. API 기동 시 경고 로그)
- 로그인 `NTMS` / `admin` / `Ntms#Prod2026!`
  (시드 비밀번호가 저장소에 있고 서버가 공인 IP라 바꿨다)

```bash
# 배포
git push origin dev
ssh ntms 'cd /opt/ntms && git fetch origin && git reset --hard origin/dev -q'
ssh ntms 'cd /opt/ntms && bash docker/deploy.sh'
```

```bash
# 시드 — ADMIN_DATABASE_URL 을 일회성 컨테이너에만 주입한다
ssh ntms 'cd /opt/ntms && set -a && . ./.env && set +a && \
  docker compose -f docker/docker-compose.yml --env-file .env run --rm --no-deps \
  -e ADMIN_DATABASE_URL="postgresql://ntms_admin:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-ntms}?schema=ntms" \
  api node apps/api/dist/scripts/seed.js'
```

`seed-demo.js` 도 같은 방식이되 **비밀번호를 반드시 갈아끼운다.** 안 넣으면
저장소에 적힌 값으로 데모 계정 18개가 생기고, 이 서버는 공인 IP 에 HTTP 다.

```bash
ssh ntms 'cd /opt/ntms && set -a && . ./.env && set +a &&   docker compose -f docker/docker-compose.yml --env-file .env run --rm --no-deps   -e ADMIN_DATABASE_URL="postgresql://ntms_admin:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-ntms}?schema=ntms"   -e DEMO_USER_PASSWORD="$(openssl rand -base64 18)"   api node apps/api/dist/scripts/seed-demo.js -- --reset'
```

무작위로 넣으면 그 계정으로는 아무도 못 들어온다 — 데모 화면을 채우는 것이
목적이고 로그인은 `admin` 으로 하기 때문에 그것으로 충분하다. 시드 로그
끝줄이 `(비밀번호: 환경변수)` 인지 확인할 것.

`docker-compose.yml` 의 api 서비스에 `ADMIN_DATABASE_URL` 을 **넣지 말 것.**
앱 컨테이너가 BYPASSRLS DSN 을 상시 들고 있으면 침해 시 테넌트 격리가 통째로
무너진다.

### 밟았던 것

- **동적 경로가 502** — nginx `proxy_buffer_size` 4k 가 Next.js 의 폰트 preload
  `link:` 헤더보다 작았다. 64k / `proxy_buffers 8 64k` 로 올려 해결.
- **새로고침하면 로그아웃** — `cookieSecure = isProd` 인데 HTTP 라 쿠키가 안
  실렸다. `COOKIE_SECURE` 환경변수로 분리.
- **DNS lame delegation** — `.kr` 이 gabia NS 를 가리키는데 gabia 가 REFUSED.
  사용자가 직접 고쳤다. 서버 쪽(`server_name _;`)은 처음부터 정상이었다.

---

## 7. 디자인 — "관제 (Control Room)"

자세한 것은 `docs/design-system.md`. 여기서는 **새 화면을 만들 때 지켜야 하는
것**만.

### 축 어휘 — 이 앱의 서명

화면마다 하나의 축을 세우고, 그 축에서 벗어난 정도로 문제를 보여준다.
새 화면을 만들면 **그 화면의 축이 무엇인지 먼저 정한다.**

| 화면 | 축 |
|---|---|
| 관제 현황 | 축 위로 흐르고 축 아래로 쌓인다 |
| 배차판 | 계획 막대 위에 실적을 겹친다 |
| 기준정보 | 남은 날을 막대 길이로 |
| 오더 등록 | 두 창 사이에 소요시간이 들어가는가 |
| 편성 | 정차 순서를 따라가며 천장을 넘는가 |
| 운송실행 | 계획선에서 오른쪽으로 얼마나 벗어났는가 |
| 실적 | 계획이 0선에 서고 실제가 좌우로 벌어진다 |
| 사용자 · 권한 | 되돌릴 수 없는 쪽으로 얼마나 뻗어 있는가 |
| 공통코드 | 끄면 드롭다운에서 무엇이 사라지나 |
| 감사로그 | 마흔 칸 중 바뀐 한 칸 |
| **정산** | **아직 안 정했다 — 다음 사람이 정할 것** |

**축은 방향을 갖는다.** 편차 축은 오른쪽으로 벌어진 만큼이 초과고, 지연 전파
축은 오른쪽이 늦은 것이고, 권한 격자는 오른쪽이 되돌릴 수 없는 것이다.
새 축을 세울 때 "오른쪽이 무엇인가" 를 먼저 정하면 나머지가 따라온다.

### 지켜야 하는 것

- **토큰만 쓴다.** 색·간격·반경을 직접 적지 않는다 (`text-content-primary`,
  `bg-surface-card`, `border-line-subtle`, `rounded-card` …).
- `.eyebrow` 는 **라틴·숫자 전용**이다. 자간을 벌리므로 한글에 걸면 "통 합 연 계"
  처럼 낱글자가 흩어진다. 한글 마이크로 라벨은 `.eyebrow-ko`.
- 숫자·시각·코드에는 `.tabular` — 자릿수가 흔들리면 표에서 줄이 안 맞는다.
- 폼은 `noValidate` 를 반드시 붙인다. 안 붙이면 브라우저 기본 검증이 submit 을
  가로채 zod 오류가 화면에 영영 안 뜬다.
- 빈 화면은 "없습니다" 로 끝내지 않는다. 왜 비었는지와 다음에 할 일을 적는다.
- 범례 없는 그림은 그림에 그친다. 막대·색이 뭘 뜻하는지 적는다.

### 글

- 화면이 답해야 하는 질문을 제목으로 삼는다. "무엇이 시간을 먹나" 처럼.
- 지난 일과 지금 할 일을 갈라 쓴다. 끝난 운송에 "미리 알리세요" 라고 적으면
  그 문구는 곧 아무도 안 읽는 배경이 된다.
- 경보를 남발하지 않는다. 한 번 안 믿기 시작한 경보는 진짜일 때도 안 본다.

---

## 8. 시드가 지켜야 하는 것 (`apps/api/src/scripts/seed-demo.ts`)

집계 화면은 데이터 없이 설계할 수 없다. 그래서 시드는 "행을 채우는 것" 이 아니라
**화면이 판단할 거리를 만드는 것**이다. 지금까지 알아낸 규칙:

1. **상태가 시각을 정한다.** 차량 가용성으로 시각을 정하고 상태를 나중에 붙이면
   '완료' 트립이 밤 11시에 끝난다. 그러면 인수증 경과가 전부 0시간이 되고
   정시율이 아직 오지 않은 도착을 센다. 지금은 시각을 먼저 정하고 **그 시각에
   비어 있는 차**를 고른다.
2. **짝지어 꺼낸다.** 예외 유형·설명, 인수 결과·사유를 따로 뽑으면 "차량고장 —
   고속도로 정체로 지연" 같은 줄이 나오고, 보는 사람은 그 한 줄에서 데이터
   전체를 못 믿기 시작한다. `EXCEPTION_KINDS` · `POD_FLAWS` 처럼 묶어 둔다.
3. **난수보다 나머지 연산.** `rnd()` 는 고정 시드라, 확률로 뽑으면 어떤 종류가
   한 건도 안 나오는 수가 있다. 화면에 그 칸이 늘 비면 그 칸을 아무도 안 본다.
   `executionCount % 3 === 1` 처럼 확정적으로 흩는다.
4. **분포에 두 갈래를 만든다.** 도크 마감을 한 가지 폭으로 흩으면 전부 넉넉해져
   지연이 아무 데도 안 걸린다. 3할은 빠듯하게, 나머지는 넉넉하게.
5. **차종 구성이 물동량을 감당해야 한다.** 트립 무게가 19~21톤이면 실을 수 있는
   차가 25톤 트레일러뿐이다. 5대로는 한 대에 열 건이 쌓인다(→10대로 늘렸다).
6. `--reset` 시 **FK 역순으로** 지운다. 새 자식 테이블을 만들면 삭제 목록에도
   추가할 것 — 안 그러면 다음 `--reset` 이 FK 로 죽는다. FK 만이 아니라
   **트리거 순서**도 본다 (`trg_actual_close_guard` — 9절).
7. **지표가 자기 꼬리를 물지 않는지 본다.** 확정 관문이 인수증 없는 실적을
   막으므로, 확정분만 세는 인수증 완료율은 정의상 늘 100% 다. 시드를 어떻게
   바꿔도 안 움직이는 지표는 시드 문제가 아니라 정의 문제다.
8. **표본이 작으면 비율이 톱니가 된다.** 하루 2~6건에서 정시율은
   0/33/50/100 만 나온다. 추세선을 쓰는 화면은 하루 물량이 그 추세를 감당할
   만큼 있어야 한다.
9. **고정 단가로 만든 금액은 상수 지표를 낳는다.** 매출을 `거리 × 1650`,
   매입을 `거리 × 1280` 으로 만들면 마진율이 언제나 22.4% 다. 요율표를 태워
   화주·차종·권역마다 갈리게 해야 그 칸이 정보를 준다.
10. **기준정보 시드는 덮어쓰지 않는다.** 코드 그룹처럼 운영자가 화면에서
   고치는 표는, 시드가 다시 돌 때 **없는 것만 넣고 있는 것은 둔다.** 배포가
   운영자의 수정을 되돌리면 그 화면은 두 번 다시 쓰이지 않는다.

---

## 9. 마지막 작업 — 실적 확정 · 시스템관리 (커밋 `492be08` `30d1656`)

### 실적 — 축을 90도 돌렸다

여기까지 모든 화면의 축은 시간이었다. 실적 화면이 열릴 때 그 질문은 이미
끝나 있다 — 차는 돌아왔고 물건은 내렸다. 남은 질문은 **계획과 실제가 어디서
갈라졌고 그 차이를 누가 무는가**다.

그래서 계획이 가운데 0선에 서고 실제가 좌우로 벌어진다
(`VarianceSpine`). 막대 길이는 줄마다 눈금이 다르다(거리는 %, 대기는 분).
한 눈금으로 통일하면 읽기는 쉬워지지만 뜻이 틀려지므로, 막대는 **모양**으로
두고 정확한 값은 오른쪽 숫자에 맡긴다.

**확정이 경계다.** 확정된 실적은 정산이 물고 가고, 세금계산서가 나가면
고치는 길은 조정 전표뿐이다. `evaluateConfirmGate()` 가 그 경계이고 화면과
서버가 같이 부른다. 서버가 한 번 더 부르는 것은 화면을 믿지 않아서가 아니라,
화면이 판정한 뒤 확정을 누르기까지 사이에 인수증이 취소될 수 있어서다.

관문은 **목록에서도** 보인다. 상세를 열어야 이유를 알면 스무 건을 확정하려고
스무 번을 연다.

한 표를 세 각도로 본다 — 건별이면 실적, 차량별로 접으면 운행일보, 날짜별로
접으면 KPI. 셋 다 `transport_actual` 을 읽으므로 한 컨트롤러에 있다.

### 시스템관리 — 세 화면, 세 질문

| 화면 | 답하는 질문 | 장치 |
|---|---|---|
| 사용자 · 권한 | 이 사람이 어디까지 되돌릴 수 없는 일을 하나 | `buildReachGrid()` |
| 공통코드 | 이 코드를 끄면 다른 화면에서 무엇이 사라지나 | `buildCodePreview()` |
| 감사로그 | 이 값이 언제 누가 무엇에서 무엇으로 바뀌었나 | `diffSnapshot()` |

권한 격자의 **가로축 순서가 그림의 전부**다 — 조회 · 등록 · 수정 · 내보내기 ·
삭제 · 승인. 알파벳순이나 CRUD 순으로 두면 격자가 아무 말도 안 한다.
안 가진 권한도 윤곽으로 남긴다(비교가 되려면 모두 같은 모양이어야 한다).
아예 없는 권한은 빈칸이다 — **없는 것과 안 준 것은 다르다.**

세로축은 `permission.module_code` 가 아니라 **권한코드의 앞자리**를 쓴다.
DB 는 DISPATCH 를 PLAN 에, RATE 를 MASTER 에 접어 두었는데, 화면을 쓰는
사람은 그것을 다른 일로 안다.

공통코드는 **왼쪽이 편집, 오른쪽이 결과**다. 미리보기는 화면이 자기 식으로
그리지 않고 실제 드롭다운이 쓰는 함수를 그대로 부른다 — 미리보기가 진짜와
다르면 그건 미리보기가 아니라 거짓말이다.

감사 상세는 JSON 두 덩이를 나란히 놓지 않는다. 마흔 칸에서 바뀐 한 칸을
찾는 일을 사람에게 시키면 분쟁이 났을 때 아무도 이 화면을 안 연다.

### 창구

```
GET   /actuals?from=&to=&status=&blockedOnly=   목록 + 요약
POST  /actuals/generate                          실행 → 실적 생성 (from·to 필요)
POST  /actuals/confirm                           일괄 확정 — 관문에 걸리면 건별 사유
GET   /actuals/:id                               편차 축 · 관문 · 정차 · 예외 · 이력
POST  /actuals/:id/hold  /reopen                 보류 · 확정해제 (사유 필수)
GET   /actuals/daily?date=   /kpi?from=&to=      운행일보 · KPI
POST  /actuals/rebuild                           집계 다시 찍기

GET   /system/users?…  /users/:id  /roles        계정 · 권한 격자
PATCH /system/users/:id                          역할은 지우고 다시 넣는다(감사 가독성)
POST  /system/users/:id/unlock  /deactivate      사유 필수. 막을 땐 세션도 끊는다
GET   /system/code-groups  /:groupId             그룹 · 코드 · 미리보기
POST  PATCH DELETE  …/codes…                     잠긴 그룹은 사유별로 다르게 거절
GET   /system/audit?…  /:id  /trail  /facets     변경 목록 · 바뀐 칸 · 레코드 내력
```

### 이번에 고친 것

- **`@Roles` 를 읽는 가드가 없었다.** 데코레이터만 있고 `RolesGuard` 가
  없어서, 붙여도 아무 효력이 없는 상태였다. 만들어 등록했고, 조회전용
  계정으로 시스템 창구 셋 모두 403 을 확인했다. (4절 참고)
- **`pod_completion_rate` 가 구조적으로 늘 100% 였다.** 확정 관문이 인수증
  없는 실적을 막으므로 확정분만 세면 정의상 100 이다. 이 한 지표만 분모를
  그날 전체(미확정 포함)로 돌렸다. 나머지는 "확정된 것만 센다" 를 그대로 둔다.
- 공통코드가 **0행**이었다 → 10그룹 59코드. 계정이 **2명**뿐이었다 → 20명.

### 밟을 뻔한 것

- `user_type` 은 `PARTNER` 가 아니라 `SHIPPER` / `CARRIER` 다.
  `user_status` 에는 `PENDING` 도 있다. `login_result` 는 `FAIL` 이 아니라
  `FAIL_PASSWORD` 처럼 **실패 종류**를 든다. TypeScript 를 `as never` 로
  달래면 컴파일은 통과하고 **런타임에서 Prisma 가 거절**한다. enum 은
  `psql -c "select unnest(enum_range(NULL::ntms.타입))"` 로 먼저 볼 것.
- `useApiMutation` 은 **변수 객체를 통째로 요청 본문으로** 보낸다.
  `{ codeId, body }` 처럼 한 겹 싸면 서버가 `body` 라는 키를 받아 스키마에
  걸린다. 평평하게 펴서 보내고 경로에 쓸 id 만 골라 쓴다.
- `curl` 은 Windows 바이너리라 `-o /tmp/x` 가 `C:\tmp\x` 로 간다.
  Git Bash 의 `/tmp` 와 다른 곳이다.
- 로컬 검증 중 **`/auth/login` 의 5분 10회 제한**을 다 써서 브라우저가 429 로
  튕긴 적이 있다. 한도를 낮추지 말고 API 를 재기동해 카운터를 비운다
  (메모리 저장이다).

---

## 10. 다음 사람에게 — 매출/매입 정산

파이프라인의 마지막 칸이다. 이것을 채우면 오더에서 돈까지가 닫힌다.

### 정산은 실적 위에서만 존재한다

스키마가 그렇게 못 박아 두었다.

```
settlement_detail.actual_id            → transport_actual   (FK)
settlement_detail.actual_order_id      → actual_order       (FK)
transport_actual.billing_settlement_id → settlement         (역참조 FK)
```

`settlement`(헤더) · `settlement_detail`(명세) · `settlement_charge`(부대비) ·
`settlement_adjustment`(조정) · `tax_invoice` · `payment_record`(수금·지급) ·
`settlement_close`(기간 마감) 으로 나뉘어 있고, `settlement_type` 으로
매출(BILLING)과 매입(PAYMENT)을 가른다. **둘이 같은 구조**라 화면 하나를
`type` 만 바꿔 두 번 쓸 수 있다.

### 쓸 수 있는 재료 (DB 를 직접 조회해 확인한 것)

| 재료 | 상태 |
|---|---|
| `rate_table` / `rate_table_detail` | **6 / 64행**, 매출3·매입3, DISTANCE·PER_TRIP·ZONE 모두 APPROVED |
| `transport_actual` | 확정 실적이 `billing_amount` · `payment_amount` · `margin_amount` 를 이미 칸으로 든다 |
| `transport_exception` | `settlement_impact` · `damage_amount` · `liability_party` 가 채워져 있다 |
| `surcharge_type` | **0행** — 시드 필요 (WAITING · EXTRA_STOP · HANDLING · TOLL · ISLAND · NIGHT) |
| `partner_contract` | **0행** — 시드 필요 |
| 메뉴 · 권한 · 채번 | `seed.ts` 에 **이미 있다** (`STL_*` 4개, `SETTLEMENT.*` 4권한, `ST` prefix MONTHLY) |
| 운임 계산 엔진 | **없다.** `rate-detail.ts` 는 요율 *편집* 스키마이지 계산기가 아니다 |

### 생각해 볼 축

정산이 답해야 하는 질문은 "얼마 벌었나" 가 아니라 **"돈이 어디서 멈춰
있나"** 일 가능성이 높다. `settlement_status` 가 10단계인 것이 곧 관문의
연속이다.

가로축을 금액으로, 세로로 관문을 쌓으면 각 단계에서 **줄어든 폭이 그 관문에
걸린 돈**이 된다 — 실적 확정 → 정산 생성 → 확정·승인 → 계산서 발행 → 수금.
매출과 매입이 같은 구조이므로 사다리를 위아래로 겹치면 **그 사이 폭이
마진**이다. 대시보드의 파이프라인과 형제이되 단위가 건수가 아니라 금액이다.

상세는 "이 금액이 **어떻게** 나왔나" 에 답해야 한다. `calculation_detail`
JSONB 에 산출 근거를 남기게 되어 있는 이유가 그것이다 — 운임표가 개정돼도
과거 정산을 재현할 수 있어야 한다.

`calculateRate()` 를 `@ntms/shared` 에 두면 시드도 그것을 부를 수 있고,
그러면 8절 9번(고정 단가가 상수 지표를 낳는 문제)이 같이 풀린다.

### 먼저 밟게 될 지뢰

1. **`trg_actual_close_guard`** (`db/ddl/91_trigger.sql`) — `settlement_close`
   가 CLOSED 면 그 기간의 `transport_actual` **INSERT/UPDATE 가 42501 로
   죽는다.** `--reset` 은 `settlement_close` 를 `transport_actual` 보다
   **먼저** 지워야 한다. 이건 FK 가 아니라 트리거라 삭제 순서 규칙만으로는
   안 걸린다.
2. **순환 FK** — `settlement.tax_invoice_id` ↔ `tax_invoice.settlement_id`.
   지우려면 한쪽을 NULL 로 먼저 푼다.
3. **`CHECK (total_amount = supply_amount + tax_amount)`** — 반올림으로 1원만
   어긋나도 INSERT 자체가 죽는다. 합계를 먼저 만들고 역산하지 말 것.
   `settlement_detail` · `settlement_adjustment` · `tax_invoice` 모두 같다.
4. **`CHECK (paid_amount <= total_amount + 0.01)`** — 과입금이 안 들어간다.
5. **월 단위 정산에는 몇 달치 데이터가 필요하다.** `settlement_year_month` 가
   `CHAR(6)` 이고 마감도 월 단위인데, 지금 시드는 13일치뿐이라 마감할 지난
   달도 연체 미수도 안 생긴다. `HISTORY_DAYS` 를 늘려야 한다 —
   그러면 8절 8번(표본이 작아 정시율이 톱니가 되는 문제)도 같이 풀린다.

### 이어서 볼 것

`C:\Users\neosy\.claude\plans\merry-bouncing-blanket.md` 에 정산 구현
계획이 단계별로 적혀 있다(축 · shared 판정 · 창구 · 화면 · 시드 · 검증).
로컬 경로라 저장소 밖이지만, 없더라도 이 절만으로 다시 세울 수 있게 적었다.

---

## 11. 더 볼 것

- `db/README.md` — 스키마 · 마이그레이션
- `docker/README.md` — 가동계 배포 절차
- `docs/design-system.md` — 토큰 · 타이포 · 컴포넌트
- 커밋 메시지 — 각 단계에서 **왜 그렇게 했는지**를 길게 적어 뒀다.
  `git log --format='%h %s%n%n%b' -12` 로 훑으면 판단의 흐름이 보인다.
