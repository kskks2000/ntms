# NTMS 데이터베이스

통합 연계 운송관리시스템(TMS)의 PostgreSQL 스키마.

- **DBMS** : PostgreSQL 18
- **스키마** : `ntms`
- **멀티테넌시** : 공유 DB / 공유 스키마 + `tenant_id` 판별자 + RLS

로컬 개발과 서버 배포의 메이저 버전을 18로 통일한다. 로컬에서 검증한 DDL이
서버에서 그대로 동작하는 것을 보장하기 위해서다. 서버는 `postgres:18-alpine`
컨테이너, 로컬은 네이티브 설치본을 쓴다.

---

## 실행

```powershell
# 1. 데이터베이스 생성
psql -U postgres -h localhost -c "CREATE DATABASE ntms ENCODING 'UTF8' TEMPLATE template0"

# 2. 전체 DDL 실행 (반드시 저장소 루트에서)
$env:PGCLIENTENCODING = 'UTF8'
psql -U postgres -h localhost -d ntms -v ON_ERROR_STOP=1 -f db/run_all.sql
```

`ON_ERROR_STOP=1` 없이 실행하지 말 것. 중간 실패를 무시하면 일부 테이블만 생성된
상태로 남아 원인 추적이 어려워진다.

### 파일 순서

| 파일 | 내용 |
|---|---|
| `00_init.sql` | 스키마 · 확장 · 도메인 · 공통 함수(감사/테넌트/채번) |
| `01_enum.sql` | 상태·구분 ENUM 타입 |
| `02_system.sql` | 테넌트 · 공통코드 · 채번 · 사용자/권한 · 감사 · 연계 · 배치 |
| `03_master_org.sql` | 조직 · 거래처 · 계약 · 행정구역 · 권역 · 거점 · 구간거리 |
| `04_master_fleet.sql` | 차종 · 차량 · 정비 · 기사 · 차량기사배정 |
| `05_master_item.sql` | 품목분류 · 포장유형 · 품목 |
| `06_rate.sql` | 운임표 · 운임상세 · 부대비용 · 유류할증 |
| `07_order.sql` | 운송오더 · 품목 · 상태이력 · 전이규칙 |
| `08_plan.sql` | 편성(Trip) · 정차지 · 배정 · 입찰 · 배차 · 차량가용성 |
| `09_execution.sql` | 운송실행 · 정차실적 · 이벤트 · POD · GPS · 온도 · 예외 |
| `10_actual.sql` | 운송실적 · 오더별실적 · 운행일보 · 근무기록 · KPI |
| `11_settlement.sql` | 정산 · 상세 · 부대비 · 조정 · 세금계산서 · 수금지급 · 마감 |
| `90_partition.sql` | 파티션 생성 및 관리 함수 |
| `91_trigger.sql` | 공통 트리거 부착 |
| `92_rls.sql` | 행 수준 보안 정책 |
| `93_app_role.sh` | Docker 전용. `ntms_app` / `ntms_admin` 에 로그인 권한 부여 |
| `94_auth.sql` | 인증 전용 함수 (`fn_auth_resolve_tenant`) |

`db/migration/` 은 위와 별개다. 이미 만들어진 DB 에 적용하는 변경분이며,
아래 *스키마 변경* 장에서 설명한다.

---

## 스키마 변경 (마이그레이션)

`db/ddl/` 은 **현재 스키마의 정본**이다. `db/migration/` 은 **이미 만들어진 DB 를
그 정본 상태까지 따라오게 하는 변경분**이다. 둘 다 고쳐야 한다.

```
db/ddl/         현재 스키마 전체       → 새 DB 를 만들 때 실행된다
db/migration/   NNNN_설명.sql 변경분   → 기존 DB 에 순서대로 적용된다
```

컨테이너의 `db/ddl` 자동 실행은 **볼륨이 비어 있을 때만** 일어난다. 데이터가
생긴 뒤에는 DDL 파일을 아무리 고쳐도 서버 DB 에는 아무 일도 일어나지 않는다.
에러도 나지 않고 조용히 무시된다. 그래서 마이그레이션이 필요하다.

### 변경 절차

1. `db/ddl/` 의 해당 파일을 고친다 (정본 갱신)
2. `db/migration/` 에 같은 변경을 하는 파일을 추가한다

   ```
   db/migration/0001_add_order_urgency.sql
   ```

3. 로컬에서 적용하고 확인한다

   ```bash
   bash db/migrate.sh --dry-run     # 무엇이 실행될지 확인
   bash db/migrate.sh               # 적용
   ```

4. 커밋 · 푸시 → 서버에서 `docker/deploy.sh` 가 애플리케이션 기동 **전에**
   자동으로 적용한다

`prisma db pull` 은 3번 이후에 돌린다.

### 규칙

| 규칙 | 이유 |
|---|---|
| 적용된 파일은 수정하지 않는다 | 체크섬이 어긋나면 실행이 중단된다. 고칠 것은 새 번호로 추가한다 |
| 파일 안에서 `BEGIN`/`COMMIT` 을 쓰지 않는다 | 스크립트가 파일 하나를 트랜잭션 하나로 감싼다. 실패하면 통째로 되돌아간다 |
| 트랜잭션 밖에서 실행해야 하면 `NNNN_설명.notx.sql` | `CREATE INDEX CONCURRENTLY`, 일부 `ALTER TYPE` 등 |
| `db/ddl/` 을 같이 고친다 | 신규 DB 는 DDL 로만 만들어진다. 빠뜨리면 새 DB 에만 그 변경이 없다 |

### 적용 이력

`ntms.schema_migration` 에 파일명 · 체크섬 · 적용 시각이 남는다.

```bash
bash db/migrate.sh --status
```

이 시스템을 처음 도입한 DB 에서는 기존 마이그레이션 파일이 **기준선**으로
기록된다(실행하지 않고 적용된 것으로 표시). `db/ddl` 로 만들어진 DB 에는 그
내용이 이미 들어 있기 때문이다.

### 되돌리기

자동 롤백은 없다. 되돌리는 SQL 을 새 마이그레이션으로 추가한다.
운영 데이터가 들어간 뒤에는 **적용 전에 백업**한다.

```bash
docker exec ntms-postgres pg_dump -U postgres -Fc ntms -f /backup/before-migration.dump
```

아직 데이터가 없는 단계에서는 볼륨을 지우고 DDL 로 다시 만드는 편이 빠르다.

```bash
docker compose -f docker/docker-compose.yml --env-file .env down -v
bash docker/deploy.sh --no-pull
```

---

## 설계 원칙

### 1. 멀티테넌시 — 3중 방어

| 계층 | 수단 | 막는 것 |
|---|---|---|
| DB | RLS 정책 | 애플리케이션이 `WHERE tenant_id` 를 빠뜨림 |
| DB | `fn_guard_tenant` 트리거 | 다른 테넌트 ID 로 위조 INSERT / tenant_id 변경 |
| App | 세션 컨텍스트 주입 | 인증 토큰의 테넌트를 트랜잭션에 바인딩 |

애플리케이션은 **모든 트랜잭션 시작 시** 다음을 실행해야 한다.

```sql
SET LOCAL app.tenant_id = '1';
SET LOCAL app.user_id   = '10';
SET LOCAL app.client_ip = '10.0.0.5';
```

`SET LOCAL` 이어야 한다. `SET` 을 쓰면 커넥션 풀에서 다음 요청으로 값이 새어
**다른 테넌트의 데이터가 노출된다.**

배포 후 아래가 0건인지 반드시 확인한다.

```sql
SELECT * FROM ntms.v_rls_status WHERE has_tenant_id AND NOT rls_enabled;
```

### 2. 계획과 실행의 분리

```
편성(trip) → 배정(allocation) → 배차(dispatch) → 실행(execution) → 실적(actual) → 정산(settlement)
```

각 단계를 별도 테이블로 둔 이유는 **차이를 기록하기 위해서**다.
계획 도착시각과 실제 도착시각의 차이가 지연이고, 계획 수량과 인도 수량의
차이가 사고이며, 그 차이들이 전부 정산 근거가 된다. 한 테이블에 덮어쓰면
"무엇이 잘못됐는지" 를 영원히 알 수 없다.

재배정·차량교체도 같은 이유로 이력 테이블(`allocation.allocation_seq`,
`dispatch_history`)에 남긴다.

### 3. 스냅샷 병행 보관

`dispatch`, `settlement_detail`, `transport_actual` 등은 거래처명·차량번호·
주소를 **FK 와 함께 문자열로도** 저장한다.

마스터가 바뀌었다고 지난달 정산 명세서의 내용이 달라지면 안 되기 때문이다.
FK 는 추적용, 스냅샷은 증빙용이다.

### 4. 확정 이후에는 조정만

`transport_actual.confirm_status = CONFIRMED` 인 실적과 확정된 정산은
직접 수정하지 않는다. 금액 변경은 `settlement_adjustment` 라인 추가로만 한다.
`settlement_close` 로 마감된 기간은 트리거가 실적 변경 자체를 차단한다.

### 5. 산출 근거의 재현성

`settlement_detail.calculation_detail` (JSONB) 에 적용 운임표·매칭 구간·
중간 계산값을 전부 남긴다. 운임표가 개정되어도 과거 정산이 어떻게 계산됐는지
재현할 수 있어야 한다. 분쟁 시 이 필드가 유일한 근거다.

---

## 공통 규약

### 키

- PK : `BIGINT GENERATED ALWAYS AS IDENTITY` (단일 컬럼)
- 업무 키 : `order_no`, `trip_no` 등. `ntms.fn_next_no()` 로 채번
- 외부 노출 : `tenant.tenant_uuid`, `user_account.user_uuid` (순번 추측 방지)

### 공통 컬럼

```sql
created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
created_by   BIGINT,
updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
updated_by   BIGINT,
deleted_at   TIMESTAMPTZ,      -- 소프트 삭제 (핵심 테이블만)
deleted_by   BIGINT,
row_version  INTEGER NOT NULL DEFAULT 0   -- 낙관적 락
```

트리거가 자동 관리하므로 애플리케이션에서 세팅하지 않는다.
`is_active` (업무상 사용중지) 와 `deleted_at` (기술적 삭제) 는 다른 개념이다.

### 도메인 (단위 일관성)

| 도메인 | 타입 | 용도 |
|---|---|---|
| `d_amount` | `NUMERIC(18,2)` | 금액 |
| `d_unit_rate` | `NUMERIC(18,4)` | 단가·요율 |
| `d_rate_pct` | `NUMERIC(9,4)` | 비율(%) |
| `d_weight_kg` | `NUMERIC(14,3)` | 중량 |
| `d_volume_cbm` | `NUMERIC(14,4)` | 부피 |
| `d_distance` | `NUMERIC(12,3)` | 거리(km) |
| `d_latitude` / `d_longitude` | `NUMERIC(10,7)` | 좌표 (범위 검증 포함) |

테이블마다 정밀도가 달라지는 사고를 막기 위해 도메인으로 고정했다.

### ENUM vs 공통코드

- **ENUM** : 워크플로 분기에 직접 쓰이는 상태값. 값이 바뀌면 로직도 바뀐다.
- **`ntms.code`** : 테넌트가 자유롭게 추가/변경하는 분류값.

ENUM 값 추가는 `ALTER TYPE ... ADD VALUE` 로 가능하지만 삭제는 불가하다.
상태 추가 시 `order_status_rule` 전이 규칙도 함께 갱신할 것.

---

## 파티션

| 테이블 | 파티션 키 | 보존 |
|---|---|---|
| `audit_log` | `changed_at` | 5년 |
| `login_history` | `login_at` | 1년 |
| `interface_log` | `request_at` | 6개월 |
| `gps_log` | `collected_at` | 1년 |
| `temperature_log` | `collected_at` | 2년 |

월 단위 RANGE 파티션. 매월 배치로 관리한다.

```sql
SELECT ntms.fn_create_monthly_partitions('gps_log', 3);   -- 3개월 앞까지 생성
SELECT ntms.fn_drop_old_partitions('gps_log', 12);        -- 12개월 초과분 삭제
```

`gps_log` 는 30초 주기 · 차량 100대 기준 **월 800만 행**이다.
B-Tree 대신 BRIN 인덱스를 쓴 이유가 여기 있다 — 시계열 데이터에서
인덱스 크기가 수백 배 작다.

---

## DB 레벨 무결성 장치

애플리케이션 버그가 데이터를 오염시키는 것을 DB가 막는 지점들:

| 장치 | 대상 | 막는 것 |
|---|---|---|
| `ex_vehicle_availability` (GiST EXCLUDE) | `vehicle_availability` | 같은 차량 이중 배차 |
| `ex_rate_table_period` (GiST EXCLUDE) | `rate_table` | 운임 적용기간 중복 |
| `ux_allocation_accepted` | `allocation` | 한 트립에 수락 배정 2건 |
| `ux_dispatch_active_trip` | `dispatch` | 한 트립에 유효 배차 2건 |
| `ux_vehicle_driver_main` | `vehicle_driver` | 한 차량에 주기사 2명 |
| `trg_transport_order_status` | `transport_order` | 허용되지 않은 상태 전이 |
| `trg_actual_close_guard` | `transport_actual` | 마감 기간 실적 변경 |
| `ux_order_external` | `transport_order` | 외부 오더 중복 수신 |

---

## Prisma 연동

이 스키마는 **SQL 우선(SQL-first)** 으로 관리한다. RLS · 파티션 · GiST 배제제약 ·
도메인은 Prisma 스키마 언어로 표현할 수 없기 때문이다.

```bash
# DDL 적용 후 Prisma 모델 생성
npx prisma db pull       # DB → schema.prisma 역생성
npx prisma generate      # 타입 생성
```

이후 스키마 변경도 **DDL 파일을 먼저 고치고** `db pull` 로 반영한다.
`prisma migrate dev` 로 스키마를 바꾸면 RLS 정책과 트리거가 유실된다.

### 테넌트 컨텍스트 주입

```ts
// 모든 요청은 이 래퍼를 통과해야 한다
export async function withTenant<T>(
  prisma: PrismaClient,
  ctx: { tenantId: bigint; userId: bigint; clientIp?: string },
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${ctx.tenantId}'`);
    await tx.$executeRawUnsafe(`SET LOCAL app.user_id   = '${ctx.userId}'`);
    if (ctx.clientIp) {
      await tx.$executeRawUnsafe(`SET LOCAL app.client_ip = '${ctx.clientIp}'`);
    }
    return fn(tx);
  });
}
```

> `$executeRawUnsafe` 를 쓰되 **값은 반드시 서버에서 검증된 숫자여야 한다.**
> 사용자 입력을 그대로 넣으면 SQL 인젝션이 된다. `SET LOCAL` 은
> 파라미터 바인딩을 지원하지 않으므로 타입 검증이 유일한 방어다.

애플리케이션은 `ntms_app` 역할로 접속한다. 이 역할은 RLS 적용 대상이며
`BYPASSRLS` 권한이 없다. 마이그레이션만 `ntms_admin` 을 쓴다.

### 인증 단계의 예외 (`94_auth.sql`)

로그인은 **테넌트를 아직 모르는 상태**에서 시작한다. 그런데 `tenant` 에도 RLS 가
걸려 있어 `app.tenant_id` 없이는 한 행도 보이지 않는다 — 회사코드로 테넌트를
찾는 것 자체가 불가능하다.

이 한 지점만 `SECURITY DEFINER` 함수로 뚫는다.

```sql
SELECT * FROM ntms.fn_auth_resolve_tenant('NTMS');
```

애플리케이션에 `ntms_admin`(BYPASSRLS) 커넥션을 하나 더 주는 방식보다 노출면이
훨씬 좁다. 뚫리는 것은 `tenant` 의 지정된 몇 개 컬럼뿐이고, 그것도 회사코드가
정확히 일치하는 한 행뿐이다.

테넌트를 알아낸 다음부터는 `app.tenant_id` 만 주입한 일반 트랜잭션
(`withTenantBootstrap`)으로 계정을 조회한다. 이 구간에도 테넌트 격리는 그대로 걸려 있다.

### 공용 행 (`tenant_id IS NULL`)

`code_group` · `code` · `role` · `menu` · `batch_job` 은 `tenant_id` 가 NULL 이면
전 테넌트 공용이다. RLS 정책이 `tenant_id = current_tenant_id()` 하나뿐이면
NULL 비교가 UNKNOWN 이 되어 **공용 행이 어느 테넌트에도 보이지 않는다.**
로그인 직후 표준 역할·표준 메뉴를 못 읽는 형태로 드러난다.

그래서 이 다섯 테이블만 읽기 조건을 넓혔다(`0001_rls_shared_rows.sql`).

```sql
USING      (tenant_id IS NULL OR tenant_id = ntms.current_tenant_id())
WITH CHECK (tenant_id = ntms.current_tenant_id())
```

쓰기는 그대로 자기 테넌트 행으로 제한되므로, 공용 행의 생성·수정은
`ntms_admin` 경로(초기 데이터 적재 스크립트)에서만 가능하다.

---

## 아직 정하지 않은 것

- **정산 안분 규칙** : 혼적 트립의 운임을 오더별로 나누는 기준
  (`allocation_basis` 컬럼은 뒀으나 실제 규칙은 업무 확정 필요)
- **외부 연계 대상** : `interface_master` 구조는 잡았으나 실제 연계 시스템
  (화주 ERP / 화물정보망 / 국가물류통합정보센터) 확정 필요
- **개인정보 암호화** : `driver.account_no`, `user_account.mfa_secret` 등은
  애플리케이션 레벨 암호화 대상. 컬럼은 뒀으나 암호화 방식 미결정
- **보관기간** : 위 파티션 보존기간은 일반적 기준. 법무 검토 필요
