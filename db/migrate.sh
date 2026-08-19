#!/usr/bin/env bash
# =====================================================================
# NTMS 스키마 마이그레이션 — 저장소 루트 기준으로 실행한다.
#
#   bash db/migrate.sh              대기 중인 마이그레이션 적용
#   bash db/migrate.sh --status     적용 이력과 대기 목록만 출력
#   bash db/migrate.sh --dry-run    적용하지 않고 무엇이 실행될지만 표시
#
# 대상 선택
#   기본값은 도커 컨테이너(ntms-postgres)다.
#   로컬 네이티브 PostgreSQL 에 적용하려면:
#     MIGRATE_TARGET=native bash db/migrate.sh
#
# ---------------------------------------------------------------------
# 왜 prisma migrate 를 쓰지 않는가
#   RLS 정책 · 파티션 · GiST 배제제약 · 도메인은 Prisma 스키마 언어로
#   표현할 수 없다. prisma migrate 로 스키마를 바꾸면 이것들이 유실된다.
#   그래서 SQL 을 직접 관리하고, 적용 이력만 DB 에 남긴다.
#
# 규칙
#   1. 파일명은 NNNN_설명.sql (네 자리 일련번호). 사전순으로 실행된다.
#   2. 적용된 파일은 절대 수정하지 않는다. 체크섬이 달라지면 실행이 중단된다.
#      고칠 것이 있으면 새 번호로 파일을 하나 더 만든다.
#   3. 파일 안에서 BEGIN/COMMIT 을 쓰지 않는다. 이 스크립트가 파일 하나를
#      트랜잭션 하나로 감싸므로, 실패하면 통째로 되돌아간다.
#   4. 트랜잭션 안에서 실행할 수 없는 문장(CREATE INDEX CONCURRENTLY 등)은
#      파일명을 NNNN_설명.notx.sql 로 지어 트랜잭션 밖에서 실행되게 한다.
#   5. **마이그레이션을 추가할 때 db/ddl/ 의 해당 파일도 같이 고친다.**
#      db/ddl 은 "현재 스키마의 정본"이고 신규 DB 는 그것으로 만들어진다.
#      여기를 빠뜨리면 새로 만든 DB 에만 그 변경이 빠진다.
# =====================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

MIGRATION_DIR="db/migration"
TARGET="${MIGRATE_TARGET:-docker}"
CONTAINER="${NTMS_PG_CONTAINER:-ntms-postgres}"

say()  { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[주의] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[중단] %s\033[0m\n' "$*" >&2; exit 1; }

# --- 접속 정보 -------------------------------------------------------
PGDB=ntms
PGUSER=postgres
if [ -f .env ]; then
    v=$(grep -E '^POSTGRES_DB=' .env   | head -1 | cut -d= -f2- | tr -d '\r'); [ -n "${v:-}" ] && PGDB="$v"
    v=$(grep -E '^POSTGRES_USER=' .env | head -1 | cut -d= -f2- | tr -d '\r'); [ -n "${v:-}" ] && PGUSER="$v"
fi

# 마이그레이션은 슈퍼유저로 실행한다. RLS 정책 · 역할 · 트리거를 다루려면
# ntms_app 권한으로는 부족하다.
psql_in() {   # stdin 으로 SQL 을 받는다
    if [ "$TARGET" = native ]; then
        PGCLIENTENCODING=UTF8 psql -h localhost -U "$PGUSER" -d "$PGDB" "$@"
    else
        docker exec -i -e PGCLIENTENCODING=UTF8 "$CONTAINER" psql -U "$PGUSER" -d "$PGDB" "$@"
    fi
}
psql_q() {    # 한 줄 결과를 돌려준다
    printf '%s' "$1" | psql_in -tA -q
}

# --- 사전 점검 -------------------------------------------------------
if [ "$TARGET" = docker ]; then
    docker inspect -f '{{.State.Running}}' "$CONTAINER" >/dev/null 2>&1 \
        || die "$CONTAINER 컨테이너가 없다. 먼저 스택을 기동할 것."
    [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" = true ] \
        || die "$CONTAINER 가 실행 중이 아니다."
fi
psql_q 'SELECT 1' >/dev/null || die "DB 에 접속할 수 없다 (target=$TARGET, db=$PGDB)"

# --- 이력 테이블 -----------------------------------------------------
LEDGER_EXISTS=$(psql_q "SELECT to_regclass('ntms.schema_migration') IS NOT NULL")

mapfile -t FILES < <(find "$MIGRATION_DIR" -maxdepth 1 -name '*.sql' -type f 2>/dev/null | sort)

if [ "$LEDGER_EXISTS" != t ]; then
    say "이력 테이블 생성 (최초 실행)"
    psql_in -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE TABLE IF NOT EXISTS ntms.schema_migration (
    version     VARCHAR(200) PRIMARY KEY,
    checksum    CHAR(64)     NOT NULL,
    applied_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    applied_by  VARCHAR(100) NOT NULL DEFAULT current_user,
    duration_ms INTEGER,
    is_baseline BOOLEAN      NOT NULL DEFAULT false
);
COMMENT ON TABLE  ntms.schema_migration            IS '적용된 스키마 마이그레이션 이력';
COMMENT ON COLUMN ntms.schema_migration.checksum   IS '적용 시점 파일의 SHA-256. 이후 파일이 바뀌면 감지된다';
COMMENT ON COLUMN ntms.schema_migration.is_baseline IS 'db/ddl 로 이미 반영된 상태여서 실행하지 않고 기록만 한 건';
SQL
    echo "  ntms.schema_migration 생성됨"

    # db/ddl 은 현재 스키마의 정본이다. 방금 그것으로 만들어진 DB 에는
    # 기존 마이그레이션 내용이 이미 들어 있으므로, 실행하지 않고 기록만 한다.
    if [ ${#FILES[@]} -gt 0 ]; then
        say "기준선 설정 — ${#FILES[@]}건을 '적용됨'으로 기록 (실행하지 않음)"
        for f in "${FILES[@]}"; do
            n=$(basename "$f"); s=$(sha256sum "$f" | cut -d' ' -f1)
            printf "INSERT INTO ntms.schema_migration(version, checksum, is_baseline) VALUES ('%s','%s',true);\n" "$n" "$s" \
                | psql_in -v ON_ERROR_STOP=1 -q
            echo "  기준선: $n"
        done
    fi
fi

# --- 상태 계산 -------------------------------------------------------
APPLIED=$(psql_q "SELECT string_agg(version || ' ' || checksum, E'\n') FROM ntms.schema_migration")

PENDING=()
for f in "${FILES[@]:-}"; do
    [ -n "${f:-}" ] || continue
    n=$(basename "$f"); s=$(sha256sum "$f" | cut -d' ' -f1)
    if printf '%s\n' "$APPLIED" | grep -qF "$n "; then
        # 이미 적용된 파일이 바뀌었는지 확인한다.
        printf '%s\n' "$APPLIED" | grep -qF "$n $s" \
            || die "적용된 마이그레이션이 수정되었다: $n
       적용 시점과 내용이 다르다. 이미 반영된 변경을 되돌릴 수는 없으므로
       이 파일은 원래대로 되돌리고, 수정 사항은 새 번호로 추가할 것."
    else
        PENDING+=("$f")
    fi
done

if [ "${1:-}" = "--status" ]; then
    say "적용 이력"
    psql_in -q <<'SQL'
SELECT version AS "파일",
       to_char(applied_at,'YYYY-MM-DD HH24:MI') AS "적용시각",
       CASE WHEN is_baseline THEN '기준선' ELSE coalesce(duration_ms::text||'ms','-') END AS "비고"
  FROM ntms.schema_migration ORDER BY version;
SQL
    say "대기 중 ${#PENDING[@]}건"
    for f in "${PENDING[@]:-}"; do [ -n "${f:-}" ] && echo "  $(basename "$f")"; done
    exit 0
fi

if [ ${#PENDING[@]} -eq 0 ]; then
    say "적용할 마이그레이션 없음 (총 ${#FILES[@]}건 기록됨)"
    exit 0
fi

say "대기 중 ${#PENDING[@]}건"
for f in "${PENDING[@]}"; do echo "  $(basename "$f")"; done

if [ "${1:-}" = "--dry-run" ]; then
    echo
    echo "--dry-run 이므로 적용하지 않고 종료한다."
    exit 0
fi

# --- 적용 ------------------------------------------------------------
for f in "${PENDING[@]}"; do
    n=$(basename "$f"); s=$(sha256sum "$f" | cut -d' ' -f1)

    # .notx.sql 은 트랜잭션 안에서 실행할 수 없는 문장을 담은 파일이다.
    case "$n" in
        *.notx.sql) tx=() ; mode="트랜잭션 없음" ;;
        *)          tx=(--single-transaction) ; mode="트랜잭션" ;;
    esac

    say "적용: $n  ($mode)"
    start=$(date +%s)
    {
        cat "$f"
        printf "\nINSERT INTO ntms.schema_migration(version, checksum, duration_ms) VALUES ('%s','%s', NULL);\n" "$n" "$s"
    } | psql_in -v ON_ERROR_STOP=1 -q "${tx[@]:-}" \
        || die "$n 적용 실패. 위 오류를 확인할 것. (트랜잭션이면 변경은 되돌아갔다)"

    ms=$(( ($(date +%s) - start) * 1000 ))
    printf "UPDATE ntms.schema_migration SET duration_ms=%d WHERE version='%s';\n" "$ms" "$n" | psql_in -q
    echo "  완료 (${ms}ms)"
done

say "마이그레이션 ${#PENDING[@]}건 적용 완료"
