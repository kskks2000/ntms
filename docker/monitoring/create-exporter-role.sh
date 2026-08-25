#!/usr/bin/env bash
# =====================================================================
# postgres_exporter 전용 DB 롤을 만든다 (멱등).
#
#   bash docker/monitoring/create-exporter-role.sh
#
# 하는 일
#   1. 비밀번호를 **서버에서** 만든다. 사람 손을 안 거치므로 어디에도
#      복사되지 않는다.
#   2. ntms_exporter 롤을 만들거나 비밀번호를 갈아끼운다.
#   3. pg_monitor 만 준다 — 통계 뷰를 읽을 뿐 데이터는 못 본다.
#   4. .env 에 POSTGRES_EXPORTER_PASSWORD 를 넣는다(이미 있으면 교체).
#
# 왜 슈퍼유저로 안 붙이나
#   지표를 보려고 만든 접속이 데이터를 고칠 수 있으면 그건 더 이상
#   모니터링이 아니다. 익스포터는 컨테이너 환경변수에 접속 문자열을 그대로
#   들고 있으므로, 그 값이 새면 곧 DB 권한이 새는 것과 같다.
#
# 다시 돌려도 안전하다. 비밀번호만 새로 발급되고, 그 뒤에는 익스포터를
# 재기동해야 새 비밀번호를 집는다.
# =====================================================================
set -euo pipefail

cd "$(dirname "$0")/../.."   # 저장소 루트

[ -f .env ] || { echo "루트에 .env 가 없다"; exit 1; }

DB=$(grep -E '^POSTGRES_DB=' .env | head -1 | cut -d= -f2-)
DB=${DB:-ntms}

# 특수문자가 섞이면 DSN 파싱과 SQL 인용에서 사고가 난다. hex 로 뽑는다.
PW=$(openssl rand -hex 24)

docker exec -i ntms-postgres psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 \
    -v pw="'$PW'" <<'SQL'
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ntms_exporter') THEN
        CREATE ROLE ntms_exporter LOGIN;
        RAISE NOTICE 'ntms_exporter 를 만들었습니다';
    ELSE
        RAISE NOTICE 'ntms_exporter 는 이미 있습니다 (비밀번호만 갱신)';
    END IF;
END $$;

-- :pw 는 위 -v 로 넘어온 값이고 따옴표까지 포함돼 있어 그대로 리터럴이 된다.
ALTER ROLE ntms_exporter PASSWORD :pw;

-- pg_monitor 는 pg_read_all_stats · pg_read_all_settings ·
-- pg_stat_scan_tables 를 묶은 것이다. 테이블 데이터 접근은 없다.
GRANT pg_monitor TO ntms_exporter;

-- RLS 는 건드리지 않는다. 익스포터는 ntms 스키마의 행을 읽지 않는다.
SQL

# .env 반영 — 값은 화면에 찍지 않는다.
if grep -qE '^POSTGRES_EXPORTER_PASSWORD=' .env; then
    sed -i "s#^POSTGRES_EXPORTER_PASSWORD=.*#POSTGRES_EXPORTER_PASSWORD=${PW}#" .env
    echo ".env 의 POSTGRES_EXPORTER_PASSWORD 를 갱신했습니다"
else
    printf '\n# postgres_exporter 전용 롤 (docker/monitoring/create-exporter-role.sh 가 발급)\nPOSTGRES_EXPORTER_PASSWORD=%s\n' "$PW" >> .env
    echo ".env 에 POSTGRES_EXPORTER_PASSWORD 를 추가했습니다"
fi

echo "완료. 익스포터를 다시 띄우세요:"
echo "  docker compose -f docker/docker-compose.yml --env-file .env up -d postgres-exporter"
