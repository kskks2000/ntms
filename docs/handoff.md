# NTMS 인수인계

이 문서는 **다음 사람(또는 다음 세션)이 이어서 개발할 수 있게** 쓴 것이다.
스키마는 `db/README.md`, 원격 배포는 `docker/README.md`, 디자인 언어는
`docs/design-system.md` 에 있으므로 여기서는 링크만 걸고 **그 문서들에 없는
것** — 지금까지 내린 판단과 그 이유, 밟았던 지뢰 — 을 적는다.

마지막 갱신: 2026-08-20 (커밋 `f48e015` 운송실행 · 트래킹)

---

## 1. 이 시스템이 무엇인가

**NTMS — 통합 연계 운송관리시스템.** 대기업이 쓰는 엔터프라이즈급 TMS.
화주의 운송 오더를 받아 트립으로 묶고, 운송사와 차량을 붙이고, 실제 운행을
관제하고, 실적을 확정해 매출·매입을 정산하기까지가 범위다.

```
오더 접수 → 편성 → 배정 → 배차 → 실행·트래킹 → 실적 확정 → 정산
   ✅        ✅     ✅     ✅        ✅            ⬜         ⬜
```

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

### 남은 범위 (사용자가 선언한 순서)

1. **실적 관리 및 확정** — 메뉴 `/actuals`, `/actuals/daily`(운행일보), `/actuals/kpi`
2. **매출/매입 정산** — 메뉴 `/settlements/billing`, `/payment`, `/invoices`, `/close`

미구현 메뉴를 누르면 `apps/web/src/app/(app)/[...slug]` 가 "준비 중" 화면을 낸다.

### 손 안 댄 채 적어만 둔 것

- 거점 좌표 일괄 지오코딩 버튼 (`/naver/geocode` 창구는 이미 있다)
- 운송사 포털 (운송사가 직접 배차 수락·실적 입력)
- 오더 예상 운임 계산 (요율표는 이미 있다)
- 오더 목록 내려받기(엑셀)
- HTTPS — 사용자가 "나중에 계획 생기면 그때" 라고 했다

---

## 3. 구조

```
apps/api      NestJS 11  :4000   도메인 모듈 = auth dashboard dispatch master order plan execution naver
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
pnpm --filter @ntms/api seed                # 권한 · 역할 · 메뉴 · 테넌트 · 관리자
pnpm --filter @ntms/api seed:demo -- --reset  # 데모 운영 데이터
pnpm dev                                    # api :4000 + web :3000
```

`http://localhost:3000/login` → `NTMS` / `admin` / `Ntms@2026!log`

### 자주 밟는 것

| 증상 | 원인 · 조치 |
|---|---|
| `EPERM ... query_engine-windows.dll.node` | API 가 뜬 채로 빌드했다. 3000·4000 포트의 node 를 죽이고 다시 |
| `pnpm lint` 에서 web 실패 | `apps/web` 에 eslint 설정 파일이 아예 없다. `next lint` 가 대화형 설정을 물어보는 것 — **기존 상태이고 코드 문제가 아니다** |
| psql 로 조회했는데 0행 | `DATABASE_URL`(ntms_app)로 붙었다. `ADMIN_DATABASE_URL` 을 쓸 것 |
| 화면이 한산하다 | 데모 트립 시각이 **실행 시점 기준**이다. `seed:demo -- --reset` 을 다시 돌린다 |

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
  api node apps/api/dist/scripts/seed.js'      # seed-demo.js 도 같은 방식
```

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
| **실적 · 정산** | **아직 안 정했다 — 다음 사람이 정할 것** |

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
   추가할 것 — 안 그러면 다음 `--reset` 이 FK 로 죽는다.

---

## 9. 마지막 작업 — 운송실행 · 트래킹 (커밋 `f48e015`)

### 설계 판단

지도는 "차가 어디 있나"에만 답한다. 관제 담당자가 정작 알아야 하는 것은
**이 지연이 앞으로 어디까지 번지나**다. 그래서 지도를 주인공으로 두지 않고
가운데 창으로 두고, 오른쪽에 **지연 전파 축**을 세웠다.

핵심 계산 (`packages/shared/src/execution.ts` 의 `buildCascade()`):

```
지난 정차   실적을 그대로 쓴다
남은 정차   마지막으로 지난 정차에서 물고 있는 지연을 계획 위에 얹는다
흡수량 = min(물고 있는 지연, max(0, 도크 여는 시각 − 계획 도착))
```

계획에 이미 기다림이 들어 있으면 지연이 거기서 흡수된다. 이걸 안 넣으면 화면이
"정차 다섯 곳 전부 40분 지연"이라고 겁을 주고, 담당자는 곧 화면을 안 믿게 된다.

화면이 내는 숫자는 "지금 40분 늦었다"(지난 일)가 아니라 **"앞으로 12분까지
버팁니다"**(지금 할 일)다 — `headroomMinutes`, 이분탐색으로 구한다.

### 창구

```
GET   /execution/board?date=          관제 보드 (요약 + 카드, 운행 중 먼저 정렬)
GET   /execution/lookup?q=            오더·트립·차량번호로 찾기 (날짜 안 받음)
GET   /execution/:id/track            정차 실적 + 지연 축 + GPS 자취 + 도로 경로
GET   /execution/exceptions?...       예외 목록 (기본 status=OPEN)
POST  /execution/exceptions           예외 등록
PATCH /execution/exceptions/:id       상태 전환 — 조치 없이 해결로 못 넘긴다
GET   /execution/pods?...             인수증 + **미도착 목록**
PATCH /execution/pods/:id/confirm     확인 / 되돌리기 — 되돌릴 땐 사유 필수
```

### 네이버 지도

- 환경변수는 NCP 콘솔이 주는 이름에 맞췄다:
  `NAVER_MAP_CLIENT_ID` / `NAVER_MAP_CLIENT_SECRET`
  (옛 이름 `NAVER_MAPS_CLIENT_ID` / `NAVER_API_KEY_ID` / `NAVER_API_KEY` 는 없앴다)
- SDK 는 `ncpKeyId=` 파라미터. `naver-map.tsx` 가 모듈 수준 Promise 로 **한 번만**
  받는다 — 컴포넌트마다 받으면 두 번째가 전역 `naver` 를 덮어써 첫 지도가 죽는다.
- 도로 경로는 `ExecutionService.routeCache` 로 트립마다 한 번만 받는다. 관제
  화면은 30초마다 다시 부르므로 캐시가 없으면 화면을 열어 둔 것만으로 요금이
  계속 나간다.
- **NCP 콘솔의 "Web 서비스 URL"** 에 접속 도메인이 등록돼 있어야 SDK 가 뜬다.
  지금은 `http://www.qqq.ai.kr` 과 `http://175.45.193.174` 로 동작 확인했다.
- 키가 없어도 앱은 뜬다. 지도 자리에만 안내가 뜨고 지연 전파 축은 그대로 돈다.

### 이번에 고친 데이터 버그

- `execution_stop` · `gps_log` · `transport_exception` · `pod` 가 **0행**이었다
- `todayDate()` 가 로컬 자정이라 **date 컬럼이 전부 하루 앞당겨** 저장됐다
- 트립 시각이 상태와 어긋나 '완료' 트립이 밤 11시에 끝났다
- 25톤 트레일러 5→10대 (한 대에 열 건이 쌓였다)
- 메뉴 `EXEC_TRACKING` 이 `is_active=false` 로 꺼져 있어 표준 메뉴에 추가

---

## 10. 다음 사람에게 — 실적 관리 및 확정

### 쓸 수 있는 테이블

| 테이블 | 무엇 |
|---|---|
| `transport_actual` | 실행 한 건의 확정 실적. 계획 대비 거리·시간 차이, 정시 여부, 인수증 여부, 적재율, 공차거리를 이미 칸으로 들고 있다 |
| `actual_order` | 오더 단위 실적 (인수증과 연결) |
| `kpi_daily` | 일자별 집계 |

`transport_actual.execution_id` 는 `transport_execution` 과 1:1 (`@unique`).
즉 **실행이 끝나면 실적 한 행을 만드는** 구조다. 지금은 한 행도 없다.

### 이미 준비된 재료

- 정시 여부: `execution_stop.is_on_time`, `delay_minutes`
- 인수증 여부: `pod` (미도착 판정은 `ExecutionService.missingPods()` 에 있다)
- 예외: `transport_exception` — `settlement_impact` · `damage_amount` ·
  `liability_party` 칸이 이미 있고 시드가 파손 건에 채워 넣는다
- 계획 대비: `trip.planned_distance_km` vs `transport_execution.actual_distance_km`

### 생각해 볼 축

실적 화면이 답해야 하는 질문은 "얼마나 실어 날랐나" 가 아니라 **"계획과 실제가
어디서 갈라졌고, 그 차이를 누가 문다"** 일 가능성이 높다. 확정(confirm)이 있는
화면이므로 **되돌릴 수 없는 경계**를 어디에 그을지가 설계의 중심이 된다 —
확정 뒤에는 정산이 그 숫자를 물고 가기 때문이다.

정산은 `settlement`(헤더) · `settlement_detail`(명세) · `settlement_charge`(부대비) ·
`settlement_adjustment`(조정) · `settlement_close`(기간 마감) 로 이미 나뉘어 있다.
`settlement_type` 으로 매출/매입을 가른다.

---

## 11. 더 볼 것

- `db/README.md` — 스키마 · 마이그레이션
- `docker/README.md` — 가동계 배포 절차
- `docs/design-system.md` — 토큰 · 타이포 · 컴포넌트
- 커밋 메시지 — 각 단계에서 **왜 그렇게 했는지**를 길게 적어 뒀다.
  `git log --format='%h %s%n%n%b' -12` 로 훑으면 판단의 흐름이 보인다.
