-- =====================================================================
-- 0001 : tenant_id 가 NULL 인 "전 테넌트 공용" 행을 읽을 수 있게 한다
--
-- 문제
--   code_group / code / role / menu / batch_job 은 tenant_id 가 NULL 이면
--   전 테넌트 공용(표준 코드 · 표준 역할 · 표준 메뉴)이라고 각 테이블 정의에
--   적혀 있다. 그런데 RLS 정책이 tenant_id = current_tenant_id() 하나뿐이라
--   NULL 비교가 UNKNOWN 이 되어 공용 행이 어느 테넌트에도 보이지 않았다.
--   로그인 직후 표준 역할·표준 메뉴를 읽지 못하는 형태로 드러난다.
--
-- 조치
--   위 다섯 테이블만 읽기 조건을 넓힌다. 쓰기(WITH CHECK)는 그대로 자기
--   테넌트 행으로 제한하므로, 공용 행의 생성·수정은 여전히
--   ntms_admin(BYPASSRLS) 경로에서만 가능하다.
--
--   NULL 허용 여부로 자동 판별하지 않고 이름을 직접 나열한다. 자동 판별에
--   맡기면 로그 테이블의 파티션 자식(login_history_p202608 등)까지 조건이
--   느슨해진다 — 부모 이름은 제외 목록에 있지만 자식 이름은 걸리지 않는다.
--
--   정책 전체를 다시 만들어 db/ddl/92_rls.sql 과 완전히 같은 상태로 맞춘다.
--   (여러 번 실행해도 결과가 같다)
--
-- 정본 : db/ddl/92_rls.sql
-- =====================================================================

DO $$
DECLARE
    r RECORD;
    v_global TEXT[] := ARRAY['region','permission','order_status_rule'];
    v_log    TEXT[] := ARRAY['audit_log','login_history','interface_log','batch_job_log'];
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
            EXECUTE format(
                'CREATE POLICY p_%s_tenant ON ntms.%I
                     FOR ALL
                     TO ntms_app, ntms_readonly
                     USING      (tenant_id IS NULL OR tenant_id = ntms.current_tenant_id())
                     WITH CHECK (tenant_id = ntms.current_tenant_id())',
                r.table_name, r.table_name
            );
            RAISE NOTICE '공용 행 읽기 허용: ntms.%', r.table_name;
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
