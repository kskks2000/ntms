-- =====================================================================
-- NTMS : 전체 DDL 실행 스크립트
--
-- 사용법
--   psql -U postgres -h localhost -d ntms -v ON_ERROR_STOP=1 -f db/run_all.sql
--
-- 사전 준비
--   CREATE DATABASE ntms ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;
--
-- 주의
--   ON_ERROR_STOP=1 로 실행할 것. 중간 실패를 무시하면
--   일부 테이블만 생성된 상태로 남아 원인 추적이 어려워진다.
-- =====================================================================

\set ON_ERROR_STOP on
\timing on

\echo '=== 00_init : 스키마 · 확장 · 도메인 · 공통함수 ==='
\i db/ddl/00_init.sql

\echo '=== 01_enum : 상태/구분 ENUM 타입 ==='
\i db/ddl/01_enum.sql

\echo '=== 02_system : 테넌트 · 코드 · 사용자 · 권한 · 감사 · 연계 ==='
\i db/ddl/02_system.sql

\echo '=== 03_master_org : 조직 · 거래처 · 계약 · 권역 · 거점 ==='
\i db/ddl/03_master_org.sql

\echo '=== 04_master_fleet : 차종 · 차량 · 기사 ==='
\i db/ddl/04_master_fleet.sql

\echo '=== 05_master_item : 품목 · 포장 ==='
\i db/ddl/05_master_item.sql

\echo '=== 06_rate : 운임표 · 부대비용 · 유류할증 ==='
\i db/ddl/06_rate.sql

\echo '=== 07_order : 운송오더 ==='
\i db/ddl/07_order.sql

\echo '=== 08_plan : 편성 · 배정 · 배차 ==='
\i db/ddl/08_plan.sql

\echo '=== 09_execution : 운송실행 · POD · 위치추적 · 예외 ==='
\i db/ddl/09_execution.sql

\echo '=== 10_actual : 운송실적 · 운행일보 · KPI ==='
\i db/ddl/10_actual.sql

\echo '=== 11_settlement : 정산 · 세금계산서 · 수금지급 ==='
\i db/ddl/11_settlement.sql

\echo '=== 90_partition : 파티션 생성 ==='
\i db/ddl/90_partition.sql

\echo '=== 91_trigger : 공통 트리거 부착 ==='
\i db/ddl/91_trigger.sql

\echo '=== 92_rls : 행 수준 보안 ==='
\i db/ddl/92_rls.sql

\echo ''
\echo '=== 생성 결과 ==='

SELECT
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'ntms' AND c.relkind = 'r' AND c.relispartition = false)  AS "일반 테이블",
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'ntms' AND c.relkind = 'p')                                AS "파티션 부모",
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'ntms' AND c.relispartition)                               AS "파티션",
    (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'ntms' AND t.typtype = 'e')                                AS "ENUM",
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'ntms')                                                    AS "함수",
    (SELECT count(*) FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'ntms' AND NOT tg.tgisinternal)                            AS "트리거",
    (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'ntms')                                                    AS "RLS 정책";

\echo ''
\echo '=== RLS 미적용 점검 (0건이어야 정상) ==='
SELECT table_name, rls_enabled, policy_count
  FROM ntms.v_rls_status
 WHERE has_tenant_id AND NOT rls_enabled;

\echo ''
\echo '완료.'
