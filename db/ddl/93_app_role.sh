#!/bin/sh
# =====================================================================
# ntms_app / ntms_admin 에 로그인 권한을 부여한다.
#
# 92_rls.sql 은 두 역할을 NOLOGIN 으로 만든다. 그대로 두면 애플리케이션이
# DB 에 접속할 수 없으므로 여기서 로그인과 비밀번호를 부여한다.
#
# 파일명의 93 을 유지할 것. postgres 엔트리포인트는
# /docker-entrypoint-initdb.d 의 파일을 사전순으로 실행하므로,
# 역할을 만드는 92_rls.sql 보다 반드시 뒤에 와야 한다.
#
# 최초 기동(빈 볼륨)에서만 실행된다. 이미 데이터가 있는 볼륨에서 비밀번호를
# 바꾸려면 컨테이너 안에서 직접 ALTER ROLE 을 실행한다.
#
# 지금은 슈퍼유저와 같은 비밀번호를 쓴다. 나중에 분리하려면
#   1) .env 에 APP_DB_PASSWORD 추가
#   2) 아래 APP_PW 를 "$APP_DB_PASSWORD" 로 변경
#   3) docker-compose.yml 의 postgres.environment 에 APP_DB_PASSWORD 전달
#   4) docker-compose.yml 의 api.DATABASE_URL 비밀번호도 함께 변경
# 네 곳을 같이 바꿔야 한다. 한 곳만 바꾸면 인증 실패로 API 가 뜨지 않는다.
# =====================================================================
set -e

APP_PW="$POSTGRES_PASSWORD"
ADMIN_PW="$POSTGRES_PASSWORD"

# psql 변수(:'name')로 넘긴다. 비밀번호에 따옴표나 특수문자가 있어도 안전하다.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
     -v app_pw="$APP_PW" -v admin_pw="$ADMIN_PW" <<'EOSQL'
ALTER ROLE ntms_app   WITH LOGIN PASSWORD :'app_pw';
ALTER ROLE ntms_admin WITH LOGIN PASSWORD :'admin_pw';
EOSQL

echo "[93_app_role] ntms_app / ntms_admin 로그인 권한 부여 완료"
