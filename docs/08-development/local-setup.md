# 로컬에서 띄우기

개발 PC 에서 스택을 세우는 절차와, 여기서 자주 밟는 것들.
전체 그림은 [인수인계 문서](../handoff.md) 에 있다.

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
— 안 넣으면 저장소에 적힌 비밀번호 계정이 열여덟 개 생긴다.
[가동계 배포](../10-operations/배포-절차.md) 참고.

## 자주 밟는 것

| 증상 | 원인 · 조치 |
|---|---|
| `EPERM ... query_engine-windows.dll.node` | API 가 뜬 채로 빌드했다. 3000·4000 포트의 node 를 죽이고 다시 |
| `pnpm dev` 가 `EADDRINUSE :::3000` | 앞서 띄운 dev 서버가 아직 살아 있다. 소유자를 먼저 찾는다 — `Get-NetTCPConnection -State Listen -LocalPort 3000` 의 `OwningProcess`. **`Stop-Process -Name node` 로 한 번에 죽이지 말 것**: 편집기 언어 서버까지 날아간다 |
| 그 프로세스가 `액세스가 거부되었습니다` | 그 dev 서버가 지금 셸보다 높은 권한으로 떠 있다. **관리자 PowerShell** 에서 `Stop-Process -Id <PID> -Force` 를 해야 한다. 급하면 포트를 바꿔 피한다 — `$env:PORT=3001; pnpm --filter @ntms/web dev` |
| `pnpm lint` 에서 web 실패 | `apps/web` 에 eslint 설정 파일이 아예 없다. `next lint` 가 대화형 설정을 물어보는 것 — **기존 상태이고 코드 문제가 아니다** |
| psql 로 조회했는데 0행 | `DATABASE_URL`(ntms_app)로 붙었다. `ADMIN_DATABASE_URL` 을 쓸 것 |
| 화면이 한산하다 | 데모 트립 시각이 **실행 시점 기준**이다. `seed:demo -- --reset` 을 다시 돌린다 |
| 로그인이 갑자기 안 된다 | `/auth/login` 은 **IP당 5분에 10회**다(`auth.controller.ts`). API 를 검증하며 curl 로 여러 번 부르면 브라우저 몫까지 쓴다. 한도를 낮추지 말고 API 를 재기동해 카운터를 비운다 |
| 공통코드 화면이 비었다 | `seed`(demo 아님)를 안 돌렸다. 코드 그룹은 기준정보라 `seed.ts` 에 있다 |
| 정산 화면이 비었다 | `seed:demo` 가 정산까지 만든다. 시드 로그 끝줄에 `정산 N건 …` 이 있는지 볼 것. 없으면 `admin` 계정이 없다는 뜻이다(=`seed` 를 안 돌렸다) |
| 정산 화면 기본 달이 지난달이다 | **의도한 것이다.** 이번 달은 계산서도 수금도 아직 있을 수 없어 사다리 아랫단이 빈다 |
