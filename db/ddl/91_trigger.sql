-- =====================================================================
-- NTMS : 91_trigger.sql
-- 공통 트리거 일괄 부착
--
--   1) fn_audit_columns  : created/updated/row_version 자동 관리
--   2) fn_guard_tenant   : tenant_id 자동 주입 및 교차 테넌트 위조 차단
--   3) fn_write_audit_log: 변경 전/후 스냅샷을 audit_log 에 적재 (핵심 테이블 한정)
--
-- 테이블을 추가하면 이 스크립트를 다시 실행하면 된다 (멱등).
-- =====================================================================

SET search_path TO ntms, public;

-- ---------------------------------------------------------------------
-- 1. 감사 컬럼 트리거
--    created_at / updated_at / row_version 을 모두 가진 테이블에 부착
-- ---------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT c.relname AS table_name
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'ntms'
           AND c.relkind IN ('r','p')
           AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'created_at' AND a.attnum > 0 AND NOT a.attisdropped)
           AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'updated_at' AND a.attnum > 0 AND NOT a.attisdropped)
           AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'row_version' AND a.attnum > 0 AND NOT a.attisdropped)
         ORDER BY c.relname
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_audit_col ON ntms.%I', r.table_name, r.table_name);
        EXECUTE format(
            'CREATE TRIGGER trg_%s_audit_col BEFORE INSERT OR UPDATE ON ntms.%I
             FOR EACH ROW EXECUTE FUNCTION ntms.fn_audit_columns()',
            r.table_name, r.table_name
        );
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------
-- 2. 테넌트 가드 트리거
--    tenant_id 를 NOT NULL 로 가진 업무 테이블에 부착.
--    tenant 자신과 전역 마스터(region/permission 등)는 제외.
-- ---------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
    v_exclude TEXT[] := ARRAY['tenant','region','permission','order_status_rule'];
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
           AND a.attnotnull                       -- NOT NULL 인 경우만
           AND NOT (c.relname = ANY(v_exclude))
         ORDER BY c.relname
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_tenant ON ntms.%I', r.table_name, r.table_name);
        EXECUTE format(
            'CREATE TRIGGER trg_%s_tenant BEFORE INSERT OR UPDATE ON ntms.%I
             FOR EACH ROW EXECUTE FUNCTION ntms.fn_guard_tenant()',
            r.table_name, r.table_name
        );
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. 변경 감사 로그 트리거
--    전 테이블에 걸면 쓰기 비용이 과도하므로,
--    금액·권한·상태에 직접 관여하는 테이블에만 부착한다.
-- ---------------------------------------------------------------------
DO $$
DECLARE
    v_targets TEXT[] := ARRAY[
        -- 권한/계정
        'user_account', 'user_role', 'role_permission', 'role_menu', 'user_tenant_access',
        -- 마스터 (금액·계약에 영향)
        'business_partner', 'partner_contract', 'carrier_info', 'shipper_info',
        'vehicle', 'driver', 'location',
        -- 운임
        'rate_table', 'rate_table_detail', 'surcharge_type', 'fuel_surcharge',
        -- 거래
        'transport_order', 'transport_order_item',
        'trip', 'trip_order', 'allocation', 'dispatch',
        'transport_actual', 'actual_order',
        -- 정산
        'settlement', 'settlement_detail', 'settlement_charge',
        'settlement_adjustment', 'tax_invoice', 'payment_record', 'settlement_close'
    ];
    v_table   TEXT;
    v_pk_col  TEXT;
BEGIN
    FOREACH v_table IN ARRAY v_targets LOOP
        -- 대상 테이블의 단일 컬럼 PK 이름을 찾는다
        SELECT a.attname INTO v_pk_col
          FROM pg_constraint con
          JOIN pg_class c      ON c.oid = con.conrelid
          JOIN pg_namespace n  ON n.oid = c.relnamespace
          JOIN pg_attribute a  ON a.attrelid = c.oid AND a.attnum = con.conkey[1]
         WHERE n.nspname = 'ntms'
           AND c.relname = v_table
           AND con.contype = 'p'
         LIMIT 1;

        IF v_pk_col IS NULL THEN
            RAISE NOTICE '감사 트리거 건너뜀 (PK 없음): %', v_table;
            CONTINUE;
        END IF;

        EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_audit_log ON ntms.%I', v_table, v_table);
        EXECUTE format(
            'CREATE TRIGGER trg_%s_audit_log AFTER INSERT OR UPDATE OR DELETE ON ntms.%I
             FOR EACH ROW EXECUTE FUNCTION ntms.fn_write_audit_log(%L)',
            v_table, v_table, v_pk_col
        );
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------
-- 4. 오더 상태 전이 검증 트리거
--    order_status_rule 에 정의되지 않은 전이를 DB 레벨에서 차단한다.
--    애플리케이션 버그나 수기 UPDATE 로 인한 상태 오염을 막는 최후 방어선.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ntms.fn_validate_order_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NOT EXISTS (
            SELECT 1 FROM ntms.order_status_rule
             WHERE from_status = OLD.status
               AND to_status   = NEW.status
               AND is_allowed  = true
        ) THEN
            RAISE EXCEPTION '허용되지 않은 오더 상태 전이입니다: % -> % (order_id=%)',
                OLD.status, NEW.status, NEW.order_id
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION ntms.fn_validate_order_status() IS '오더 상태 전이 규칙 검증 (order_status_rule 기준)';

DROP TRIGGER IF EXISTS trg_transport_order_status ON ntms.transport_order;
CREATE TRIGGER trg_transport_order_status
    BEFORE UPDATE OF status ON ntms.transport_order
    FOR EACH ROW EXECUTE FUNCTION ntms.fn_validate_order_status();

-- ---------------------------------------------------------------------
-- 5. 오더 상태 이력 자동 기록 트리거
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ntms.fn_log_order_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_seq INTEGER;
BEGIN
    IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
        SELECT COALESCE(MAX(seq_no), 0) + 1 INTO v_seq
          FROM ntms.order_status_history
         WHERE order_id = NEW.order_id;

        INSERT INTO ntms.order_status_history (
            tenant_id, order_id, seq_no, from_status, to_status,
            changed_at, changed_by, change_source
        ) VALUES (
            NEW.tenant_id, NEW.order_id, v_seq,
            CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
            NEW.status, now(), ntms.current_user_id(), 'SYSTEM'
        );
    END IF;
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION ntms.fn_log_order_status() IS '오더 상태 변경 시 order_status_history 자동 기록';

DROP TRIGGER IF EXISTS trg_transport_order_status_log ON ntms.transport_order;
CREATE TRIGGER trg_transport_order_status_log
    AFTER INSERT OR UPDATE OF status ON ntms.transport_order
    FOR EACH ROW EXECUTE FUNCTION ntms.fn_log_order_status();

-- ---------------------------------------------------------------------
-- 6. 정산 마감 기간 보호 트리거
--    마감(CLOSED)된 기간의 실적은 변경할 수 없다.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ntms.fn_guard_settlement_close()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM ntms.settlement_close sc
         WHERE sc.tenant_id = NEW.tenant_id
           AND sc.status    = 'CLOSED'
           AND NEW.actual_date BETWEEN sc.period_from AND sc.period_to
    ) THEN
        RAISE EXCEPTION '마감된 정산 기간의 실적은 변경할 수 없습니다 (actual_date=%)', NEW.actual_date
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION ntms.fn_guard_settlement_close() IS '마감된 정산 기간의 실적 변경 차단';

DROP TRIGGER IF EXISTS trg_actual_close_guard ON ntms.transport_actual;
CREATE TRIGGER trg_actual_close_guard
    BEFORE INSERT OR UPDATE ON ntms.transport_actual
    FOR EACH ROW EXECUTE FUNCTION ntms.fn_guard_settlement_close();
