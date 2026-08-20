# NTMS — 통합 연계 운송관리시스템

화주의 운송 오더를 받아 트립으로 묶고, 운송사와 차량을 붙이고, 실제 운행을
관제하고, 실적을 확정해 매출·매입을 정산하기까지를 다루는 TMS.

```
오더 접수 → 편성 → 배정 → 배차 → 실행·트래킹 → 실적 확정 → 정산
   ✅        ✅     ✅     ✅        ✅            ⬜         ⬜
```

## 이어서 개발한다면

**[`docs/handoff.md`](docs/handoff.md) 를 먼저 읽는다.** 어디까지 됐는지,
남은 범위, 절대 어기면 안 되는 것(RLS · DB 트리거 · 날짜 처리), 그리고 지금까지
밟았던 지뢰가 거기 모여 있다.

## 띄우기

전제: Node 24+ · pnpm 10+ · PostgreSQL 18 · 루트에 `.env`
(`cp .env.example .env` 후 시크릿을 채운다)

```bash
pnpm install
pnpm db:create
PGCLIENTENCODING=UTF8 pnpm db:ddl             # Windows 는 인코딩 고정 필수
MIGRATE_TARGET=native bash db/migrate.sh
pnpm db:pull                                   # Prisma 모델 · 클라이언트
pnpm --filter @ntms/api seed                   # 권한 · 역할 · 메뉴 · 테넌트 · 관리자
pnpm --filter @ntms/api seed:demo -- --reset   # 데모 운영 데이터 (선택이지만 권장)
pnpm dev                                       # api :4000 + web :3000
```

`http://localhost:3000/login` → `NTMS` / `admin` / `Ntms@2026!log`

데모 트립 시각은 **실행 시점 기준**으로 만들어진다. 화면이 한산해 보이면
`seed:demo -- --reset` 을 다시 돌린다.

## 구조

```
apps/api          NestJS 11   :4000
apps/web          Next.js 15  :3000   App Router · React 19
packages/shared   zod 3               타입 + 화면과 서버가 같이 쓰는 판정 함수
packages/db       Prisma 6            db pull 로 생성. 스키마 원본은 SQL 이다
db/               SQL 원본 · 마이그레이션
docker/           가동계 배포
```

## 더 볼 것

| 문서 | 내용 |
|---|---|
| [`docs/handoff.md`](docs/handoff.md) | **인수인계** — 진행 상황 · 규칙 · 지뢰 |
| [`docs/design-system.md`](docs/design-system.md) | 디자인 시스템 "관제" |
| [`db/README.md`](db/README.md) | 스키마 · 마이그레이션 |
| [`docker/README.md`](docker/README.md) | 가동계 배포 |

커밋 메시지에는 **왜 그렇게 했는지**를 길게 적어 둔다.
`git log --format='%h %s%n%n%b' -12` 로 훑으면 판단의 흐름이 보인다.
