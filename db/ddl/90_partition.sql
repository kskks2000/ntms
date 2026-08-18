-- =====================================================================
-- NTMS : 90_partition.sql
-- 파티션 생성 및 관리
--
-- 대상 : audit_log / login_history / interface_log / gps_log / temperature_log
-- 방식 : collected_at·changed_at 기준 월 단위 RANGE 파티션
--
-- 운영 원칙
--   - 미래 3개월분을 항상 미리 만들어 둔다 (배치 fn_create_monthly_partitions)
--   - DEFAULT 파티션을 두어 범위 밖 INSERT 가 실패하지 않도록 한다
--   - 보존기간 경과분은 DROP (DELETE 보다 수천 배 빠르고 VACUUM 부담이 없다)
-- =====================================================================

SET search_path TO ntms, public;

-- ---------------------------------------------------------------------
-- 월 파티션 생성 함수
--   p_months_ahead 개월 앞까지 파티션을 만든다. 이미 있으면 건너뛴다.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ntms.fn_create_monthly_partitions(
    p_table_name   TEXT,
    p_months_ahead INTEGER DEFAULT 3,
    p_start_month  DATE    DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_start     DATE := date_trunc('month', COALESCE(p_start_month, CURRENT_DATE))::DATE;
    v_from      DATE;
    v_to        DATE;
    v_part_name TEXT;
    v_created   INTEGER := 0;
    i           INTEGER;
BEGIN
    FOR i IN 0..p_months_ahead LOOP
        v_from      := (v_start + (i || ' month')::INTERVAL)::DATE;
        v_to        := (v_from + INTERVAL '1 month')::DATE;
        v_part_name := format('%s_p%s', p_table_name, to_char(v_from, 'YYYYMM'));

        IF NOT EXISTS (
            SELECT 1 FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'ntms' AND c.relname = v_part_name
        ) THEN
            EXECUTE format(
                'CREATE TABLE ntms.%I PARTITION OF ntms.%I FOR VALUES FROM (%L) TO (%L)',
                v_part_name, p_table_name, v_from, v_to
            );
            v_created := v_created + 1;
        END IF;
    END LOOP;

    RETURN v_created;
END;
$$;

COMMENT ON FUNCTION ntms.fn_create_monthly_partitions(TEXT, INTEGER, DATE)
    IS '월 단위 파티션을 미래 N개월분까지 생성한다 (배치에서 매월 호출)';

-- ---------------------------------------------------------------------
-- 보존기간 경과 파티션 삭제 함수
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ntms.fn_drop_old_partitions(
    p_table_name    TEXT,
    p_retain_months INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_cutoff    DATE := date_trunc('month', CURRENT_DATE - (p_retain_months || ' month')::INTERVAL)::DATE;
    v_part      RECORD;
    v_dropped   INTEGER := 0;
    v_part_ym   TEXT;
BEGIN
    FOR v_part IN
        SELECT c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'ntms'
           AND c.relname ~ ('^' || p_table_name || '_p[0-9]{6}$')
    LOOP
        v_part_ym := right(v_part.relname, 6);
        IF to_date(v_part_ym, 'YYYYMM') < v_cutoff THEN
            EXECUTE format('DROP TABLE ntms.%I', v_part.relname);
            v_dropped := v_dropped + 1;
        END IF;
    END LOOP;

    RETURN v_dropped;
END;
$$;

COMMENT ON FUNCTION ntms.fn_drop_old_partitions(TEXT, INTEGER)
    IS '보존기간이 지난 월 파티션을 DROP 한다 (개인정보 보관기간 준수 포함)';

-- =====================================================================
-- 초기 파티션 생성
--   과거 1개월 + 당월 + 미래 3개월
-- =====================================================================
DO $$
DECLARE
    v_tables TEXT[] := ARRAY['audit_log','login_history','interface_log','gps_log','temperature_log'];
    v_table  TEXT;
    v_start  DATE := (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month')::DATE;
BEGIN
    FOREACH v_table IN ARRAY v_tables LOOP
        PERFORM ntms.fn_create_monthly_partitions(v_table, 4, v_start);
    END LOOP;
END;
$$;

-- =====================================================================
-- DEFAULT 파티션
--   범위를 벗어난 값(단말 시각 오류 등)이 INSERT 실패하지 않도록 받아둔다.
--   운영 중 DEFAULT 에 데이터가 쌓이면 수집 시각 이상을 의심할 것.
-- =====================================================================
CREATE TABLE ntms.audit_log_pdefault       PARTITION OF ntms.audit_log       DEFAULT;
CREATE TABLE ntms.login_history_pdefault   PARTITION OF ntms.login_history   DEFAULT;
CREATE TABLE ntms.interface_log_pdefault   PARTITION OF ntms.interface_log   DEFAULT;
CREATE TABLE ntms.gps_log_pdefault         PARTITION OF ntms.gps_log         DEFAULT;
CREATE TABLE ntms.temperature_log_pdefault PARTITION OF ntms.temperature_log DEFAULT;

-- =====================================================================
-- 보존기간 기준 (배치 파라미터로 사용)
--   audit_log       : 5년  (정산 분쟁 및 상법상 증빙)
--   login_history   : 1년  (정보통신망법 접속기록 보관 의무)
--   interface_log   : 6개월
--   gps_log         : 1년  (운행기록 보관 의무 참고)
--   temperature_log : 2년  (식품 콜드체인 품질 증빙)
-- =====================================================================
