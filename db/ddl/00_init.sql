-- =====================================================================
-- NTMS : 통합 연계 운송관리시스템 (Transport Management System)
-- 00_init.sql : 스키마 · 확장 · 공통 도메인 · 공통 함수 · 트리거 함수
-- ---------------------------------------------------------------------
-- Target   : PostgreSQL 18 (로컬 개발/서버 배포 동일 메이저 버전)
-- Schema   : ntms
-- Tenancy  : Shared DB / Shared Schema + tenant_id 판별자 + RLS
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 스키마
-- ---------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS ntms;

COMMENT ON SCHEMA ntms IS '통합 연계 운송관리시스템(NTMS) 통합 스키마';

SET search_path TO ntms, public;

-- ---------------------------------------------------------------------
-- 2. 확장
--    pgcrypto   : gen_random_uuid(), digest() 등
--    btree_gin  : 복합 인덱스에서 스칼라 + jsonb 혼합 사용
--    btree_gist : EXCLUDE 제약에서 스칼라(=) + 범위(&&) 혼합 — 운임 적용기간 중복 차단에 필수
--    pg_trgm    : 거래처/주소 부분 검색(LIKE '%..%') 인덱스
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- PostGIS 는 선택. 경로 최적화/반경 검색을 DB에서 처리할 경우 활성화하고
-- location.lat/lng 를 geography(Point,4326) 로 승격한다.
-- CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------
-- 3. 공통 도메인 (단위 일관성 강제)
--    금액/수량 정밀도를 도메인으로 고정해 테이블 간 불일치를 원천 차단한다.
-- ---------------------------------------------------------------------
CREATE DOMAIN ntms.d_amount     AS NUMERIC(18,2);   -- 금액 (원화 기준, 다통화 대비 소수 2자리)
CREATE DOMAIN ntms.d_unit_rate  AS NUMERIC(18,4);   -- 단가 / 요율
CREATE DOMAIN ntms.d_rate_pct   AS NUMERIC(9,4);    -- 비율(%) 예: 12.3456
CREATE DOMAIN ntms.d_weight_kg  AS NUMERIC(14,3);   -- 중량(kg)
CREATE DOMAIN ntms.d_volume_cbm AS NUMERIC(14,4);   -- 부피(CBM)
CREATE DOMAIN ntms.d_distance   AS NUMERIC(12,3);   -- 거리(km)
CREATE DOMAIN ntms.d_latitude   AS NUMERIC(10,7) CHECK (VALUE BETWEEN -90  AND 90);
CREATE DOMAIN ntms.d_longitude  AS NUMERIC(10,7) CHECK (VALUE BETWEEN -180 AND 180);
CREATE DOMAIN ntms.d_biz_no     AS VARCHAR(10) CHECK (VALUE ~ '^[0-9]{10}$');  -- 사업자등록번호(숫자 10)
CREATE DOMAIN ntms.d_corp_no    AS VARCHAR(13) CHECK (VALUE ~ '^[0-9]{13}$');  -- 법인등록번호(숫자 13)

COMMENT ON DOMAIN ntms.d_amount     IS '금액 도메인 NUMERIC(18,2)';
COMMENT ON DOMAIN ntms.d_unit_rate  IS '단가/요율 도메인 NUMERIC(18,4)';
COMMENT ON DOMAIN ntms.d_rate_pct   IS '비율(%) 도메인 NUMERIC(9,4)';
COMMENT ON DOMAIN ntms.d_weight_kg  IS '중량(kg) 도메인 NUMERIC(14,3)';
COMMENT ON DOMAIN ntms.d_volume_cbm IS '부피(CBM) 도메인 NUMERIC(14,4)';
COMMENT ON DOMAIN ntms.d_distance   IS '거리(km) 도메인 NUMERIC(12,3)';

-- ---------------------------------------------------------------------
-- 4. 세션 컨텍스트 함수
--    애플리케이션은 트랜잭션 시작 시 아래 GUC 를 설정한다.
--      SET LOCAL app.tenant_id = '1';
--      SET LOCAL app.user_id   = '10';
--    RLS 정책과 감사 트리거가 이 값을 사용한다.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ntms.current_tenant_id()
RETURNS BIGINT
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::BIGINT;
$$;

COMMENT ON FUNCTION ntms.current_tenant_id() IS '현재 세션의 테넌트 ID (RLS 판별 기준). 미설정 시 NULL';

CREATE OR REPLACE FUNCTION ntms.current_user_id()
RETURNS BIGINT
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::BIGINT;
$$;

COMMENT ON FUNCTION ntms.current_user_id() IS '현재 세션의 사용자 ID (감사 컬럼 자동 기입용). 미설정 시 NULL';

CREATE OR REPLACE FUNCTION ntms.current_client_ip()
RETURNS INET
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.client_ip', true), '')::INET;
$$;

COMMENT ON FUNCTION ntms.current_client_ip() IS '현재 세션의 클라이언트 IP (감사로그 기록용)';

-- ---------------------------------------------------------------------
-- 5. 공통 트리거 함수 : 감사 컬럼 자동 관리
--    - INSERT : created_at/created_by/updated_at/updated_by 세팅
--    - UPDATE : updated_at/updated_by 갱신, row_version 증가
--               created_at/created_by 는 변조 방지를 위해 원본 유지
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ntms.fn_audit_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.created_at  := COALESCE(NEW.created_at, now());
        NEW.created_by  := COALESCE(NEW.created_by, ntms.current_user_id());
        NEW.updated_at  := NEW.created_at;
        NEW.updated_by  := NEW.created_by;
        NEW.row_version := 0;
        RETURN NEW;

    ELSIF TG_OP = 'UPDATE' THEN
        NEW.created_at  := OLD.created_at;
        NEW.created_by  := OLD.created_by;
        NEW.updated_at  := now();
        NEW.updated_by  := COALESCE(ntms.current_user_id(), NEW.updated_by);
        NEW.row_version := OLD.row_version + 1;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION ntms.fn_audit_columns() IS '공통 감사 컬럼(created/updated/row_version) 자동 관리 트리거 함수';

-- ---------------------------------------------------------------------
-- 6. 공통 트리거 함수 : 테넌트 자동 주입 및 위조 차단
--    INSERT 시 tenant_id 미지정이면 세션 값으로 채우고,
--    세션 테넌트와 다른 값을 넣으려 하면 예외를 던진다.
--    UPDATE 시 tenant_id 변경을 금지한다(테넌트 이관은 별도 배치로만).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ntms.fn_guard_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_session_tenant BIGINT := ntms.current_tenant_id();
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.tenant_id IS NULL THEN
            IF v_session_tenant IS NULL THEN
                RAISE EXCEPTION 'tenant_id 가 없고 세션 app.tenant_id 도 설정되지 않았습니다 (table=%)', TG_TABLE_NAME
                    USING ERRCODE = '23502';
            END IF;
            NEW.tenant_id := v_session_tenant;
        ELSIF v_session_tenant IS NOT NULL AND NEW.tenant_id <> v_session_tenant THEN
            RAISE EXCEPTION '세션 테넌트(%)와 다른 tenant_id(%) 로 INSERT 할 수 없습니다 (table=%)',
                v_session_tenant, NEW.tenant_id, TG_TABLE_NAME
                USING ERRCODE = '42501';
        END IF;
        RETURN NEW;

    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.tenant_id <> OLD.tenant_id THEN
            RAISE EXCEPTION 'tenant_id 는 변경할 수 없습니다 (table=%, % -> %)',
                TG_TABLE_NAME, OLD.tenant_id, NEW.tenant_id
                USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION ntms.fn_guard_tenant() IS 'tenant_id 자동 주입 및 교차 테넌트 위조/변경 차단 트리거 함수';

-- ---------------------------------------------------------------------
-- 7. 공통 트리거 함수 : 변경 감사 로그 (audit_log 적재)
--    민감 컬럼은 마스킹하여 기록한다.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ntms.fn_write_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_before   JSONB;
    v_after    JSONB;
    v_pk       TEXT;
    v_tenant   BIGINT;
    v_masked   TEXT[] := ARRAY['password_hash','mfa_secret','account_no','token_hash'];
    v_col      TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_after  := to_jsonb(NEW);
        v_before := NULL;
    ELSIF TG_OP = 'UPDATE' THEN
        v_before := to_jsonb(OLD);
        v_after  := to_jsonb(NEW);
        -- 실제 변경이 없으면 기록하지 않는다
        IF v_before = v_after THEN
            RETURN NEW;
        END IF;
    ELSE
        v_before := to_jsonb(OLD);
        v_after  := NULL;
    END IF;

    FOREACH v_col IN ARRAY v_masked LOOP
        IF v_before ? v_col THEN v_before := jsonb_set(v_before, ARRAY[v_col], '"***"'); END IF;
        IF v_after  ? v_col THEN v_after  := jsonb_set(v_after,  ARRAY[v_col], '"***"'); END IF;
    END LOOP;

    v_pk     := COALESCE(v_after, v_before) ->> (TG_ARGV[0]);
    v_tenant := NULLIF(COALESCE(v_after, v_before) ->> 'tenant_id', '')::BIGINT;

    INSERT INTO ntms.audit_log (
        tenant_id, table_name, record_pk, action,
        before_data, after_data, changed_by, changed_at, client_ip
    ) VALUES (
        v_tenant, TG_TABLE_NAME, v_pk, TG_OP::ntms.audit_action,
        v_before, v_after, ntms.current_user_id(), now(), ntms.current_client_ip()
    );

    RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION ntms.fn_write_audit_log() IS '변경 전/후 스냅샷을 audit_log 에 적재하는 트리거 함수. 인자로 PK 컬럼명을 받는다';

-- ---------------------------------------------------------------------
-- 8. 채번 함수
--    numbering_rule 을 참조해 업무번호(오더번호/트립번호 등)를 생성한다.
--    동시성은 행 잠금(FOR UPDATE)으로 직렬화한다.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ntms.fn_next_no(
    p_tenant_id BIGINT,
    p_rule_code VARCHAR
)
RETURNS VARCHAR
LANGUAGE plpgsql
AS $$
DECLARE
    r            RECORD;
    v_today      DATE := (now() AT TIME ZONE 'Asia/Seoul')::DATE;
    v_reset      BOOLEAN := false;
    v_next       BIGINT;
    v_date_part  TEXT := '';
BEGIN
    SELECT * INTO r
      FROM ntms.numbering_rule
     WHERE tenant_id = p_tenant_id
       AND rule_code = p_rule_code
       AND is_active = true
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '채번 규칙을 찾을 수 없습니다 (tenant_id=%, rule_code=%)', p_tenant_id, p_rule_code
            USING ERRCODE = 'P0002';
    END IF;

    -- 리셋 주기 판정
    v_reset := CASE r.reset_cycle
                 WHEN 'DAILY'   THEN r.last_reset_date IS DISTINCT FROM v_today
                 WHEN 'MONTHLY' THEN COALESCE(date_trunc('month', r.last_reset_date), 'epoch')
                                       <> date_trunc('month', v_today)
                 WHEN 'YEARLY'  THEN COALESCE(date_trunc('year',  r.last_reset_date), 'epoch')
                                       <> date_trunc('year',  v_today)
                 ELSE false
               END;

    v_next := CASE WHEN v_reset THEN 1 ELSE r.current_seq + 1 END;

    UPDATE ntms.numbering_rule
       SET current_seq     = v_next,
           last_reset_date  = CASE WHEN v_reset THEN v_today ELSE last_reset_date END
     WHERE numbering_rule_id = r.numbering_rule_id;

    IF r.date_format IS NOT NULL AND r.date_format <> '' THEN
        v_date_part := to_char(v_today, r.date_format);
    END IF;

    RETURN COALESCE(r.prefix, '') || v_date_part || lpad(v_next::TEXT, r.seq_length, '0');
END;
$$;

COMMENT ON FUNCTION ntms.fn_next_no(BIGINT, VARCHAR) IS '테넌트별 업무번호 채번 (numbering_rule 기반, 접두어+일자+시퀀스)';

-- ---------------------------------------------------------------------
-- 9. 유틸 함수 : 두 좌표 간 직선거리(km) — Haversine
--    실제 도로거리는 distance_master 또는 외부 라우팅 API 를 우선한다.
--    이 함수는 근사 필터(반경 검색 1차 후보 추출)용이다.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ntms.fn_haversine_km(
    p_lat1 NUMERIC, p_lng1 NUMERIC,
    p_lat2 NUMERIC, p_lng2 NUMERIC
)
RETURNS NUMERIC
LANGUAGE sql IMMUTABLE
AS $$
  SELECT round(
    (6371 * 2 * asin(
       sqrt(
         power(sin(radians(p_lat2 - p_lat1) / 2), 2) +
         cos(radians(p_lat1)) * cos(radians(p_lat2)) *
         power(sin(radians(p_lng2 - p_lng1) / 2), 2)
       )
    ))::NUMERIC, 3);
$$;

COMMENT ON FUNCTION ntms.fn_haversine_km(NUMERIC,NUMERIC,NUMERIC,NUMERIC) IS '두 좌표 간 직선거리(km) 근사 계산 (Haversine)';
