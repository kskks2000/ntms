# @ntms/db

Prisma Client 와 스키마를 담는 패키지.

## schema.prisma 는 손으로 쓰지 않는다

스키마의 진실은 `db/ddl/*.sql` 이다. `schema.prisma` 의 `model` / `enum` 블록은
전부 DB 에서 역생성한 결과물이므로 직접 편집하지 않는다.

```
pnpm db:ddl     # DDL 적용 (권한: ntms_admin 또는 superuser)
pnpm db:pull    # DB -> schema.prisma 역생성 + 타입 생성
```

`prisma migrate` 는 사용하지 않는다. RLS 정책 · 파티션 · GiST 배제제약 · 도메인 ·
트리거는 Prisma 스키마 언어로 표현할 수 없어서, migrate 를 쓰면 그것들이 통째로 사라진다.

> `prisma db pull` 은 실행할 때마다 `schema.prisma` 를 다시 쓰면서 파일 안의 주석을
> 지운다. 그래서 이 문서가 스키마 파일이 아니라 여기에 있다.

## db pull 이 표현하지 못하는 것

역생성된 스키마에는 아래가 반영되지 않는다. Prisma Client 만 보고 작업하면 놓친다.

**1. `tstzrange` — Prisma 가 모르는 타입**

`vehicle_availability.occupied_period` 가 `Unsupported("tstzrange")` 로 들어간다.
이 컬럼은 Prisma Client 로 읽거나 쓸 수 없다. 차량 점유 구간 등록/조회는
`$queryRaw` / `$executeRaw` 로 처리한다. GiST 배제제약(`ex_vehicle_availability`)이
이중 배차를 DB 레벨에서 막으므로, 겹치는 구간을 넣으면 예외가 올라온다.

**2. 파티션 테이블**

`audit_log`, `gps_log`, `interface_log`, `login_history`, `temperature_log` 는
파티션 부모다. Prisma 는 일반 테이블로 취급한다. INSERT/SELECT 는 되지만
파티션 추가는 `db/ddl/90_partition.sql` 쪽에서 관리한다.

**3. RLS — 커넥션마다 테넌트 컨텍스트를 넣어야 한다**

정책은 전부 `tenant_id = ntms.current_tenant_id()` 형태이고, 이 함수는
`current_setting('app.tenant_id', true)` 를 읽는다 (`db/ddl/00_init.sql:68`).
설정하지 않으면 **모든 조회가 0건**이다. 에러가 아니라 빈 결과라 조용히 틀린다.

Prisma 는 커넥션 풀을 쓰기 때문에 세션 단위 `SET` 은 다른 요청으로 새어나간다.
반드시 트랜잭션 안에서 `SET LOCAL` 로 설정한다.

```ts
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${String(tenantId)}, true)`;
  await tx.$executeRaw`SELECT set_config('app.user_id',   ${String(userId)},   true)`;
  return tx.order.findMany();
});
```

`app.user_id`, `app.client_ip` 도 같은 방식으로 읽힌다 (감사 로그 트리거가 사용).

## 접속 역할

애플리케이션은 반드시 `ntms_app` 으로 접속한다. `postgres` 나 `ntms_admin`
(`BYPASSRLS`) 으로 붙으면 RLS 가 통째로 무시되어 테넌트 데이터가 섞인다.
자세한 내용은 저장소 루트 `.env.example` 참고.
