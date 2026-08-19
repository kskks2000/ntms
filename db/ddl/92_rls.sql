-- =====================================================================
-- NTMS : 92_rls.sql
-- 행 수준 보안 (Row Level Security) — 멀티테넌트 격리의 최종 방어선
--
-- 애플리케이션이 WHERE tenant_id = ? 를 빠뜨려도 DB가 막는다.
-- 트랜잭션 시작 시 반드시 아래를 실행해야 한다.
--
--   SET LOCAL app.tenant_id = '<테넌트ID>';
--   SET LOCAL app.user_id   = '<사용자ID>';
--
-- Prisma 사용 시 $transaction 안에서 $executeRawUnsafe 로 설정한다.
-- 커넥션 풀 환경에서 SET LOCAL 은 트랜잭션 종료와 함께 해제되므로
-- 다른 요청으로 값이 새지 않는다. (SET LOCAL 이 아닌 SET 은 절대 금지)
-- =====================================================================

SET search_path TO ntms, public;

-- =====================================================================
-- 1. 애플리케이션 역할
-- =====================================================================
DO $$
BEGIN
    -- 애플리케이션 접속 역할 (RLS 적용 대상)
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ntms_app') THEN
        CREATE ROLE ntms_app NOLOGIN;
    END IF;

    -- 마이그레이션/운영 관리 역할 (RLS 우회)
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ntms_admin') THEN
        CREATE ROLE ntms_admin NOLOGIN BYPASSRLS;
    END IF;

    -- 읽기 전용 분석 역할 (BI/리포트)
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ntms_readonly') THEN
        CREATE ROLE ntms_readonly NOLOGIN;
    END IF;
END;
$$;

COMMENT ON ROLE ntms_app      IS 'NTMS 애플리케이션 접속 역할 (RLS 적용)';
COMMENT ON ROLE ntms_admin    IS 'NTMS 마이그레이션/운영 역할 (BYPASSRLS)';
COMMENT ON ROLE ntms_readonly IS 'NTMS 읽기 전용 분석 역할 (RLS 적용)';

GRANT USAGE ON SCHEMA ntms TO ntms_app, ntms_admin, ntms_readonly;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA ntms TO ntms_app;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA ntms TO ntms_app;
GRANT EXECUTE                        ON ALL FUNCTIONS IN SCHEMA ntms TO ntms_app;
GRANT ALL                            ON ALL TABLES    IN SCHEMA ntms TO ntms_admin;
GRANT SELECT                         ON ALL TABLES    IN SCHEMA ntms TO ntms_readonly;

-- 이후 생성되는 객체에도 동일 권한이 자동 적용되도록 기본 권한을 지정한다
ALTER DEFAULT PRIVILEGES IN SCHEMA ntms GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ntms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA ntms GRANT USAGE, SELECT ON SEQUENCES TO ntms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA ntms GRANT SELECT ON TABLES TO ntms_readonly;

-- =====================================================================
-- 2. RLS 정책 일괄 적용
--    tenant_id 컬럼을 가진 모든 테이블에 테넌트 격리 정책을 부착한다.
--
--    - USING      : SELECT/UPDATE/DELETE 시 보이는 행을 제한
--    - WITH CHECK : INSERT/UPDATE 시 기록 가능한 행을 제한
--    - app.tenant_id 미설정(NULL)이면 아무 행도 보이지 않는다 (안전 기본값)
-- =====================================================================
DO $$
DECLARE
    r RECORD;
    -- 전역 공용 테이블 (tenant_id 자체가 없음)
    v_global TEXT[] := ARRAY['region','permission','order_status_rule'];
    -- 시스템 로그 : tenant_id 가 NULL 일 수 있다.
    --   로그인 실패(계정 미존재), 연계 수신 오류, 전역 배치처럼
    --   테넌트를 특정할 수 없는 사건도 기록해야 하기 때문이다.
    --   일반 정책(tenant_id = current_tenant_id())을 그대로 걸면
    --   NULL 비교가 UNKNOWN 이 되어 기록 자체가 거부된다.
    v_log   TEXT[] := ARRAY['audit_log','login_history','interface_log','batch_job_log'];
    -- 공용 행 테이블 : tenant_id IS NULL 이 "전 테넌트 공용" 을 뜻하는 곳.
    --   각 테이블 정의에 그렇게 적혀 있는데도 tenant_id = current_tenant_id()
    --   만 걸면 NULL 비교가 UNKNOWN 이 되어 공용 행이 어느 테넌트에도 보이지
    --   않는다. 로그인 직후 표준 역할·표준 메뉴를 못 읽는 사고가 여기서 난다.
    --
    --   NULL 허용 여부(attnotnull)로 자동 판별하지 않고 이름을 직접 나열한다.
    --   자동 판별에 맡기면 로그 테이블의 파티션 자식들까지 읽기 조건이
    --   느슨해진다 — 부모는 v_log 로 걸러지지만 자식 이름은 걸리지 않는다.
    v_shared TEXT[] := ARRAY['code_group','code','role','menu','batch_job'];
BEGIN
    FOR r IN
        SELECT c.relname AS table_name
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_attribute a ON a.attrelid = c.oid
         WHERE n.nspname = 'ntms'
           AND c.relkind IN ('r','p')
           AND a.attname = 'tenant_id'
           AND a.attnum > 0
           AND NOT a.attisdropped
           AND NOT (c.relname = ANY(v_global))
           AND NOT (c.relname = ANY(v_log))
         ORDER BY c.relname
    LOOP
        EXECUTE format('ALTER TABLE ntms.%I ENABLE ROW LEVEL SECURITY', r.table_name);
        EXECUTE format('ALTER TABLE ntms.%I FORCE  ROW LEVEL SECURITY', r.table_name);

        EXECUTE format('DROP POLICY IF EXISTS p_%s_tenant ON ntms.%I', r.table_name, r.table_name);

        IF r.table_name = ANY(v_shared) THEN
            -- 공용 행 : 읽기는 NULL 행까지 허용하고, 쓰기는 자기 테넌트 행으로 막는다.
            -- 공용 행의 생성·수정은 ntms_admin(BYPASSRLS) 경로에서만 가능하다.
            EXECUTE format(
                'CREATE POLICY p_%s_tenant ON ntms.%I
                     FOR ALL
                     TO ntms_app, ntms_readonly
                     USING      (tenant_id IS NULL OR tenant_id = ntms.current_tenant_id())
                     WITH CHECK (tenant_id = ntms.current_tenant_id())',
                r.table_name, r.table_name
            );
        ELSE
            EXECUTE format(
                'CREATE POLICY p_%s_tenant ON ntms.%I
                     FOR ALL
                     TO ntms_app, ntms_readonly
                     USING      (tenant_id = ntms.current_tenant_id())
                     WITH CHECK (tenant_id = ntms.current_tenant_id())',
                r.table_name, r.table_name
            );
        END IF;
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------
-- 2-1. 시스템 로그 테이블 정책
--      읽기 : 자기 테넌트 행만 (NULL 행은 관리자만 조회)
--      쓰기 : 무조건 허용 — 감사 기록이 실패하면 안 되기 때문
--      로그는 append-only 이며 UPDATE/DELETE 권한을 주지 않는다.
-- ---------------------------------------------------------------------
DO $$
DECLARE
    v_log   TEXT[] := ARRAY['audit_log','login_history','interface_log','batch_job_log'];
    v_table TEXT;
BEGIN
    FOREACH v_table IN ARRAY v_log LOOP
        EXECUTE format('ALTER TABLE ntms.%I ENABLE ROW LEVEL SECURITY', v_table);
        EXECUTE format('ALTER TABLE ntms.%I FORCE  ROW LEVEL SECURITY', v_table);

        EXECUTE format('DROP POLICY IF EXISTS p_%s_read   ON ntms.%I', v_table, v_table);
        EXECUTE format('DROP POLICY IF EXISTS p_%s_append ON ntms.%I', v_table, v_table);

        EXECUTE format(
            'CREATE POLICY p_%s_read ON ntms.%I
                 FOR SELECT TO ntms_app, ntms_readonly
                 USING (tenant_id = ntms.current_tenant_id())',
            v_table, v_table
        );
        EXECUTE format(
            'CREATE POLICY p_%s_append ON ntms.%I
                 FOR INSERT TO ntms_app
                 WITH CHECK (true)',
            v_table, v_table
        );

        -- append-only : 로그 위변조 차단
        EXECUTE format('REVOKE UPDATE, DELETE ON ntms.%I FROM ntms_app', v_table);
    END LOOP;
END;
$$;

-- =====================================================================
-- 3. tenant 테이블 자기 자신에 대한 정책
--    사용자는 자신이 속한 테넌트 정보만 볼 수 있다.
-- =====================================================================
ALTER TABLE ntms.tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE ntms.tenant FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_tenant_self ON ntms.tenant;
CREATE POLICY p_tenant_self ON ntms.tenant
    FOR ALL
    TO ntms_app, ntms_readonly
    USING      (tenant_id = ntms.current_tenant_id())
    WITH CHECK (tenant_id = ntms.current_tenant_id());

-- =====================================================================
-- 4. 전역 공용 테이블 : 읽기만 허용
-- =====================================================================
DO $$
DECLARE
    v_global TEXT[] := ARRAY['region','permission','order_status_rule'];
    v_table  TEXT;
BEGIN
    FOREACH v_table IN ARRAY v_global LOOP
        EXECUTE format('ALTER TABLE ntms.%I ENABLE ROW LEVEL SECURITY', v_table);
        EXECUTE format('DROP POLICY IF EXISTS p_%s_read ON ntms.%I', v_table, v_table);
        EXECUTE format(
            'CREATE POLICY p_%s_read ON ntms.%I FOR SELECT TO ntms_app, ntms_readonly USING (true)',
            v_table, v_table
        );
    END LOOP;
END;
$$;

-- =====================================================================
-- 5. 검증 헬퍼
--    RLS 가 실제로 붙었는지 확인하는 뷰. 배포 후 반드시 점검할 것.
-- =====================================================================
CREATE OR REPLACE VIEW ntms.v_rls_status AS
SELECT
    c.relname                                   AS table_name,
    c.relrowsecurity                            AS rls_enabled,
    c.relforcerowsecurity                       AS rls_forced,
    (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count,
    EXISTS (
        SELECT 1 FROM pg_attribute a
         WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
           AND a.attnum > 0 AND NOT a.attisdropped
    )                                           AS has_tenant_id
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'ntms'
   AND c.relkind IN ('r','p')
 ORDER BY c.relname;

COMMENT ON VIEW ntms.v_rls_status IS 'RLS 적용 현황 점검용 뷰. has_tenant_id=true 인데 rls_enabled=false 면 격리 구멍';

GRANT SELECT ON ntms.v_rls_status TO ntms_admin;

-- =====================================================================
-- 사용 예 (애플리케이션 트랜잭션)
-- ---------------------------------------------------------------------
--   BEGIN;
--     SET LOCAL app.tenant_id = '1';
--     SET LOCAL app.user_id   = '10';
--     SET LOCAL app.client_ip = '10.0.0.5';
--     SELECT * FROM ntms.transport_order WHERE status = 'RECEIVED';
--   COMMIT;
--
-- 점검 쿼리
--   SELECT * FROM ntms.v_rls_status WHERE has_tenant_id AND NOT rls_enabled;
--   -- 결과가 0건이어야 한다
-- =====================================================================
