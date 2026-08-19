-- =====================================================================
-- NTMS : 94_auth.sql
-- 인증 전용 함수
--
-- 로그인은 "아직 테넌트를 모르는 상태"에서 시작한다. 그런데 ntms.tenant 에도
-- RLS 가 걸려 있어(p_tenant_self), app.tenant_id 가 없으면 ntms_app 에게는
-- 단 한 행도 보이지 않는다. 즉 회사코드로 테넌트를 찾는 것 자체가 불가능하다.
--
-- 이 한 지점만 SECURITY DEFINER 함수로 뚫는다. 애플리케이션에 ntms_admin
-- (BYPASSRLS) 커넥션을 하나 더 주는 방식보다 노출면이 훨씬 좁다 —
-- 뚫리는 것은 tenant 테이블의 지정된 몇 개 컬럼뿐이고, 그것도 회사코드가
-- 정확히 일치하는 한 행뿐이다.
--
-- 주의
--   * SECURITY DEFINER 함수에는 반드시 search_path 를 고정한다.
--     고정하지 않으면 호출자가 만든 동명 객체로 함수 본문이 바뀔 수 있다.
--   * 반환 컬럼을 늘릴 때는 "로그인 화면에 보여도 되는 값인가" 를 먼저 묻는다.
--     이 함수는 인증 전에 호출되므로 반환값은 사실상 공개 정보다.
-- =====================================================================

SET search_path TO ntms, public;

-- ---------------------------------------------------------------------
-- 회사코드 → 테넌트 식별
--   로그인 1단계, 계정신청 1단계에서 호출한다.
--   존재하지 않으면 0행을 반환한다(예외를 던지지 않는다).
-- ---------------------------------------------------------------------
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
AS $$
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
$$;

COMMENT ON FUNCTION ntms.fn_auth_resolve_tenant(VARCHAR)
    IS '회사코드로 테넌트를 찾는다. 인증 전 단계이므로 RLS 를 우회한다(SECURITY DEFINER)';

REVOKE ALL      ON FUNCTION ntms.fn_auth_resolve_tenant(VARCHAR) FROM PUBLIC;
GRANT  EXECUTE  ON FUNCTION ntms.fn_auth_resolve_tenant(VARCHAR) TO ntms_app;
