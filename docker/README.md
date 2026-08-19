# NTMS 서버 배포

NAVER Cloud 단일 VM(Rocky Linux 8 · vCPU 2 · RAM 16GB)에 Docker 스택으로 배포한다.

| 항목 | 값 |
|---|---|
| 공인 IP | `175.45.193.174` |
| 접속 계정 | `root` (PEM 키) |
| 배포 경로 | `/opt/ntms` |
| 외부 노출 | nginx `80` (HTTPS 는 도메인 확보 후) |
| 내부 전용 | postgres · redis · api · web — 호스트 포트를 열지 않는다 |

구성 요소와 튜닝값은 `docker-compose.yml`, 스키마 설계는 `../db/README.md` 를 본다.

---

## 0. 배포 전 확인

**세 가지가 선행돼야 한다. 하나라도 빠지면 중간에 막힌다.**

1. **ACG 인바운드에 80 개방** — 2026-08-19 기준 22 · 80 · 443 도달 확인됨.
   5432 · 6379 는 차단 상태가 정상이다(외부 노출 지점은 nginx 뿐).

2. **서버 80 포트 비우기** — 포트 개방 검증용 임시 웹서버가 떠 있으면
   nginx 컨테이너가 포트를 잡지 못한다. root 홈이 그대로 공개되므로 보안상으로도
   반드시 내린다.

   ```bash
   ss -tlnp | grep -E ':(80|443)\s'
   pkill -f 'http.server'
   ```

3. **배포할 커밋이 원격에 올라가 있을 것** — 서버는 GitHub 에서 clone 한다.
   로컬에만 있는 수정은 서버에 반영되지 않는다.

---

## 1. 서버 최초 준비 (서버당 1회)

```bash
ssh -i <키>.pem root@175.45.193.174

dnf -y install git
git clone -b dev https://github.com/kskks2000/ntms.git /opt/ntms
cd /opt/ntms

bash docker/server-setup.sh
```

`server-setup.sh` 가 하는 일 — Docker CE + compose 플러그인 설치, 부팅 시 자동
기동 등록, firewalld 에 http/https 허용, 타임존 `Asia/Seoul`, 사전 점검(디스크 ·
80 포트 점유).

SELinux 는 끄지 않는다. 컨테이너가 호스트의 DDL·nginx 설정을 읽어야 하는 지점은
`docker-compose.yml` 의 바인드 마운트에 `:z` (재라벨링)를 붙여 해결했다.
SELinux 를 끄는 것보다 이쪽이 안전하고, SELinux 가 없는 개발 환경에서는 무시된다.

> 참고: Docker 가 게시한 포트는 firewalld 의 INPUT 정책을 우회하는 경우가 많다.
> 실질적인 외부 경계는 **ACG** 다. 포트를 닫으려면 ACG 에서 닫아야 한다.

---

## 2. `.env` 작성

`.env` 는 커밋되지 않는다(공개 저장소다). 서버에서 직접 만든다.

```bash
cd /opt/ntms
cp .env.example .env
```

### 시크릿 생성

```bash
# DB · Redis 비밀번호 — 접속 URL 에 그대로 들어가므로 URL 안전 문자(hex)만 쓴다
openssl rand -hex 24    # POSTGRES_PASSWORD
openssl rand -hex 24    # REDIS_PASSWORD

# JWT 서명키 — 두 개를 서로 다른 값으로
openssl rand -base64 48 | tr -d '\n'; echo    # JWT_ACCESS_SECRET
openssl rand -base64 48 | tr -d '\n'; echo    # JWT_REFRESH_SECRET
```

비밀번호에 `@ : / ? # $` 를 넣지 않는다. `DATABASE_URL` · `REDIS_URL` 의 구분자와
겹쳐 인증이 조용히 깨진다.

### 서버에서 바꿔야 하는 값

```ini
NODE_ENV=production
PUBLIC_ORIGIN=http://175.45.193.174

POSTGRES_PASSWORD=<위에서 생성한 hex>
REDIS_PASSWORD=<위에서 생성한 hex>
JWT_ACCESS_SECRET=<생성값>
JWT_REFRESH_SECRET=<다른 생성값>
```

`PUBLIC_ORIGIN` 은 두 곳에 쓰인다 — api 의 `CORS_ORIGIN`, 그리고 web 빌드 시점의
`NEXT_PUBLIC_API_URL`(`${PUBLIC_ORIGIN}/api`). **브라우저가 보는 주소**여야 하며,
`NEXT_PUBLIC_*` 은 번들에 구워지므로 값을 바꾸면 web 이미지를 다시 빌드해야 한다.

`DATABASE_URL` · `REDIS_URL` 항목은 로컬 개발용이다. 컨테이너는
`docker-compose.yml` 이 컨테이너 네트워크 주소로 따로 주입하므로 서버에서는 쓰이지 않는다.

> **첫 기동 전에 비밀번호를 확정할 것.**
> `db/ddl/93_app_role.sh` 는 빈 볼륨일 때 한 번만 실행되어 `ntms_app` /
> `ntms_admin` 의 비밀번호를 `POSTGRES_PASSWORD` 로 정한다. 나중에 `.env` 만
> 바꾸면 API 는 새 비밀번호로 접속을 시도하는데 DB 쪽은 옛 비밀번호 그대로라
> 인증에 실패한다. 그때는 DB 안에서 직접 바꿔야 한다:
> ```bash
> docker exec -it ntms-postgres psql -U postgres -d ntms \
>   -c "ALTER ROLE ntms_app WITH PASSWORD '새비밀번호'"
> ```

```bash
chmod 600 .env
```

---

## 3. 배포

```bash
cd /opt/ntms
bash docker/deploy.sh
```

소스 갱신 → 이미지 빌드 → 기동 → 헬스체크 대기 → 검증까지 수행한다.
현재 소스 그대로 다시 올리려면 `bash docker/deploy.sh --no-pull`.

vCPU 2 기준 **최초 빌드는 10분 안팎** 걸린다(pnpm 설치 + Next.js 빌드). 이후
배포는 레이어 캐시 덕에 훨씬 짧다. 빌드에 약 5GB 디스크가 필요하다.

최초 기동 시 postgres 가 `db/ddl/` 의 파일을 이름순으로 전부 실행한다
(`00_init` → … → `92_rls` → `93_app_role`). **이 자동 실행은 볼륨이 비어 있을
때만 일어난다.**

---

## 4. 검증

`deploy.sh` 가 자동으로 확인하지만, 수동으로 볼 때의 기준값은 다음과 같다.
(로컬 검증에서 확인된 값이다.)

```bash
# 컨테이너 상태 — 5개 모두 healthy
docker compose -f docker/docker-compose.yml --env-file .env ps

# API (nginx 경유) — db:true 여야 DB 접속까지 정상
curl -s http://175.45.193.174/api/health
# {"status":"ok","db":true,"uptime":...}

# 웹
curl -s -o /dev/null -w '%{http_code}\n' http://175.45.193.174/
```

```bash
# 스키마 — 일반 테이블 77 · ENUM 56 · RLS 정책 115
docker exec -it ntms-postgres psql -U postgres -d ntms

-- RLS 미적용 테이블 (0건이어야 정상)
SELECT * FROM ntms.v_rls_status WHERE has_tenant_id AND NOT rls_enabled;

-- 접속 역할 (ntms_app · rolbypassrls = f 여야 정상)
SELECT rolname, rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname LIKE 'ntms%';
```

최초 배포라면 DDL 실행 중 에러가 없었는지 반드시 본다.

```bash
docker logs ntms-postgres 2>&1 | grep -iE 'ERROR|FATAL'
```

---

## 5. 운영

```bash
cd /opt/ntms
C="docker compose -f docker/docker-compose.yml --env-file .env"

$C ps                      # 상태
$C logs -f api             # 로그 추적 (api · web · nginx · postgres · redis)
$C restart api             # 특정 서비스 재시작
$C down                    # 전체 중지 (데이터 볼륨은 유지)
```

재부팅해도 `restart: unless-stopped` + `systemctl enable docker` 로 자동 복구된다.

### 백업

`db/backup` 이 컨테이너의 `/backup` 으로 연결돼 있다.

```bash
docker exec ntms-postgres pg_dump -U postgres -Fc ntms \
  -f /backup/ntms-$(date +%Y%m%d-%H%M).dump

ls -lh /opt/ntms/db/backup/
```

복구:

```bash
docker exec -i ntms-postgres pg_restore -U postgres -d ntms --clean --if-exists \
  /backup/ntms-20260819-1200.dump
```

### DB 를 처음부터 다시 만들기 (개발 단계 한정)

DDL 자동 실행은 빈 볼륨에서만 일어나므로, 스키마를 다시 적용하려면 볼륨을 지운다.
**데이터가 전부 사라진다. 운영 데이터가 들어간 뒤에는 쓰지 않는다.**

```bash
$C down -v
bash docker/deploy.sh --no-pull
```

---

## 6. HTTPS (도메인 확보 후)

**지금은 불가능하다.** Let's Encrypt 는 공인 IP 에 대해 인증서를 발급하지 않는다.
도메인이 준비된 뒤에 진행한다.

1. 도메인 A 레코드를 `175.45.193.174` 로 지정
2. `.env` 의 `PUBLIC_ORIGIN` 을 `https://<도메인>` 으로 변경
3. `nginx/conf.d/ntms.conf` 의 `server_name` 지정 후 인증서 발급

   ```bash
   $C run --rm certbot certonly --webroot -w /var/www/certbot \
     -d <도메인> --email <메일> --agree-tos --no-eff-email
   ```
4. `ntms.conf` 하단 HTTPS 블록 주석 해제, HTTP 는 301 리다이렉트로 변경
5. 갱신 데몬 기동 + 재빌드(`NEXT_PUBLIC_API_URL` 이 바뀌므로 web 재빌드 필요)

   ```bash
   $C --profile tls up -d certbot
   bash docker/deploy.sh --no-pull
   ```
6. ACG 443 개방 확인

---

## 7. 트러블슈팅

| 증상 | 원인 / 조치 |
|---|---|
| nginx 가 뜨지 않음 (`address already in use`) | 80 을 점유한 프로세스. `ss -tlnp \| grep :80` 후 종료 |
| api 가 `restarting` 반복 | `docker logs ntms-api`. DB 인증 실패면 `93_app_role.sh` 실행 시점의 비밀번호와 `.env` 가 어긋난 것 |
| api 헬스가 `"db":false` | postgres 는 떴지만 `ntms_app` 인증/권한 문제. 위와 동일 |
| DDL 이 하나도 실행되지 않음 | 볼륨에 데이터가 이미 있음(재기동은 정상 동작). 또는 SELinux 로 마운트를 못 읽는 경우 — 마운트에 `:z` 가 붙어 있는지 확인 |
| DDL 이 중간에 멈춤 | `down -v` 로 볼륨을 지우고 재배포해야 한다. 일부만 생성된 상태로 두면 원인 추적이 어렵다 |
| 브라우저에서 API 호출 실패(CORS) | `PUBLIC_ORIGIN` 이 실제 접속 주소와 다름. 고친 뒤 web 재빌드 |
| 빌드 중 디스크 부족 | `docker builder prune -f` 로 빌드 캐시 정리 |

---

## 8. 아직 하지 않은 것

- **SSH 접근 제한** — 22 번이 전 세계에 열려 있고 `root` 직접 로그인 구성이다.
  ACG 에서 소스 IP 를 사무실 대역으로 좁히는 것을 권한다.
- **HTTPS** — 도메인 확보 후.
- **백업 자동화** — 위 `pg_dump` 를 cron 에 걸고 외부 스토리지로 옮기는 절차 미정.
- **모니터링 · 로그 수집** — 미정.
