#!/usr/bin/env bash
# =====================================================================
# NTMS 배포 — 저장소 루트에서 실행한다.
#
#   bash docker/deploy.sh              최신 소스를 받아 빌드 후 기동
#   bash docker/deploy.sh --no-pull    git pull 없이 현재 소스로 재배포
#
# 최초 배포와 재배포 모두 이 스크립트를 쓴다.
# 기동 후 헬스체크와 RLS 점검까지 확인하고 끝난다.
# =====================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker/docker-compose.yml --env-file .env"

say()  { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[주의] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[중단] %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------
say "1/5  사전 점검"
# ---------------------------------------------------------------------
[ -f .env ] || die ".env 가 없다. cp .env.example .env 후 시크릿을 채울 것 (docker/README.md)"

# 값이 비었거나 예시 그대로면 컨테이너가 조용히 잘못된 설정으로 뜬다.
for key in POSTGRES_PASSWORD REDIS_PASSWORD JWT_ACCESS_SECRET JWT_REFRESH_SECRET PUBLIC_ORIGIN; do
    val=$(grep -E "^${key}=" .env | head -1 | cut -d= -f2-)
    [ -n "$val" ] || die ".env 의 ${key} 가 비어 있다"
    case "$val" in
        변경하세요*|*비밀번호*) die ".env 의 ${key} 가 예시값 그대로다" ;;
    esac
done

public_origin=$(grep -E '^PUBLIC_ORIGIN=' .env | head -1 | cut -d= -f2-)
case "$public_origin" in
    *localhost*) warn "PUBLIC_ORIGIN 이 ${public_origin} 다. 서버라면 http://<공인IP> 여야 브라우저에서 API 를 찾는다." ;;
    *)           echo "  PUBLIC_ORIGIN = ${public_origin}" ;;
esac

# DDL 자동 실행은 빈 볼륨에서만 일어난다. 재배포인지 최초 배포인지 미리 알린다.
if docker volume inspect ntms-postgres-data >/dev/null 2>&1; then
    echo "  기존 DB 볼륨 있음 → DDL 자동 실행은 건너뛴다 (재배포)"
    first_run=0
else
    echo "  DB 볼륨 없음 → 최초 기동 시 db/ddl 전체가 실행된다"
    first_run=1
fi

# ---------------------------------------------------------------------
if [ "${1:-}" = "--no-pull" ]; then
    say "2/5  소스 갱신 건너뜀 (--no-pull)"
else
    say "2/5  소스 갱신"
    git pull --ff-only
fi
echo "  $(git log -1 --format='%h %s')"

# ---------------------------------------------------------------------
say "3/5  이미지 빌드 및 기동"
# ---------------------------------------------------------------------
# vCPU 2 기준 최초 빌드는 10분 안팎 걸린다.
$COMPOSE up -d --build

# ---------------------------------------------------------------------
say "4/5  헬스체크 대기"
# ---------------------------------------------------------------------
deadline=$(( $(date +%s) + 300 ))
while :; do
    pending=""
    for c in ntms-postgres ntms-redis ntms-api ntms-web ntms-nginx; do
        status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$c" 2>/dev/null || echo missing)
        [ "$status" = healthy ] || pending="$pending $c($status)"
    done
    [ -z "$pending" ] && { echo "  전부 healthy"; break; }
    [ "$(date +%s)" -ge "$deadline" ] && {
        warn "5분 내에 healthy 가 되지 않았다:$pending"
        warn "로그 확인:  $COMPOSE logs --tail=50"
        exit 1
    }
    sleep 5
done

# ---------------------------------------------------------------------
say "5/5  배포 검증"
# ---------------------------------------------------------------------
echo "--- API 헬스 (nginx 경유) ---"
curl -fsS -m 10 http://127.0.0.1/api/health && echo

echo "--- 웹 응답 ---"
curl -fsS -m 10 -o /dev/null -w "  HTTP %{http_code}\n" http://127.0.0.1/

echo "--- 스키마 객체 수 ---"
docker exec -i ntms-postgres psql -U postgres -d ntms -tA -F' | ' -c "
SELECT
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='ntms' AND c.relkind='r' AND NOT c.relispartition) AS tables,
  (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname='ntms' AND t.typtype='e')                          AS enums,
  (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
     JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='ntms')                                            AS policies;"

echo "--- RLS 미적용 테이블 (0건이어야 정상) ---"
missing=$(docker exec -i ntms-postgres psql -U postgres -d ntms -tAc \
    "SELECT count(*) FROM ntms.v_rls_status WHERE has_tenant_id AND NOT rls_enabled;")
if [ "$missing" -eq 0 ]; then
    echo "  0건 — 테넌트 격리 정상"
else
    warn "${missing}건이 RLS 없이 노출된다. 아래로 확인할 것:"
    warn "  docker exec -it ntms-postgres psql -U postgres -d ntms -c 'SELECT * FROM ntms.v_rls_status WHERE has_tenant_id AND NOT rls_enabled'"
fi

echo "--- API 접속 역할 (ntms_app · BYPASSRLS 없어야 정상) ---"
docker exec -i ntms-postgres psql -U postgres -d ntms -tA -F' | ' -c \
    "SELECT usename, (SELECT rolbypassrls FROM pg_roles WHERE rolname=usename) AS bypassrls
       FROM pg_stat_activity WHERE datname='ntms' AND usename <> 'postgres' GROUP BY usename;"

if [ "$first_run" -eq 1 ]; then
    printf '\n\033[1;33m최초 배포다. DDL 실행 중 에러가 없었는지 확인할 것:\033[0m\n'
    printf '  docker logs ntms-postgres 2>&1 | grep -iE "ERROR|FATAL"\n'
fi

printf '\n\033[1;32m배포 완료 — %s\033[0m\n' "$public_origin"
