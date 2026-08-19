-- =====================================================================
-- 0003 : 인증 전용 함수 추가 (fn_auth_resolve_tenant)
--
-- 로그인 1단계에서 회사코드로 테넌트를 찾아야 하는데, ntms.tenant 에도
-- RLS(p_tenant_self)가 걸려 있어 app.tenant_id 없이는 ntms_app 에게
-- 한 행도 보이지 않는다. 이 한 지점만 SECURITY DEFINER 로 뚫는다.
--
-- 정본 : db/ddl/94_auth.sql (동일 내용)
-- =====================================================================

SET search_path TO ntms, public;

CREATE OR REPLACE FUNCTION ntms.fn_auth_resolve_tenant(p_tenant_code VARCHAR)
RETURNS TABLE (
    tenant_id   BIGINT,
    tenant_code VARCHAR,
    tenant_name VARCHAR,
    status      ntms.tenant_status,
    is_active   BOOLEAN,
    locale      VARCHAR,
    timezone    VARCHAR
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ntms, pg_temp
AS $fn$
    SELECT t.tenant_id,
           t.tenant_code,
           t.tenant_name,
           t.status,
           t.is_active,
           t.locale,
           t.timezone
      FROM ntms.tenant t
     WHERE t.tenant_code = upper(btrim(p_tenant_code))
       AND t.deleted_at IS NULL
     LIMIT 1;
$fn$;

COMMENT ON FUNCTION ntms.fn_auth_resolve_tenant(VARCHAR)
    IS '회사코드로 테넌트를 찾는다. 인증 전 단계이므로 RLS 를 우회한다(SECURITY DEFINER)';

REVOKE ALL     ON FUNCTION ntms.fn_auth_resolve_tenant(VARCHAR) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION ntms.fn_auth_resolve_tenant(VARCHAR) TO ntms_app;
