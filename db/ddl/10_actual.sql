-- =====================================================================
-- NTMS : 10_actual.sql
-- 운송실적 : 실적 헤더 · 오더별 실적 · 차량 운행일보 · 기사 근무 · KPI 집계
--
-- 실적(actual)은 실행(execution) 데이터를 검수·확정한 결과다.
-- 확정된 실적만 정산 대상이 되며, 확정 이후에는 조정(adjustment)으로만
-- 변경할 수 있다. 이 경계가 정산 신뢰성의 핵심이다.
-- =====================================================================

SET search_path TO ntms, public;

-- =====================================================================
-- 1. 운송실적 헤더
-- =====================================================================
CREATE TABLE ntms.transport_actual (
    actual_id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    actual_no           VARCHAR(30)  NOT NULL,              -- 실적번호
    execution_id        BIGINT       NOT NULL REFERENCES ntms.transport_execution(execution_id),
    dispatch_id         BIGINT       NOT NULL REFERENCES ntms.dispatch(dispatch_id),
    trip_id             BIGINT       NOT NULL REFERENCES ntms.trip(trip_id),
    actual_date         DATE         NOT NULL,              -- 실적 귀속일자 (정산 기간 판정 기준)

    -- 수행 주체 (실적 확정 시점 스냅샷)
    carrier_id          BIGINT       NOT NULL REFERENCES ntms.business_partner(partner_id),
    carrier_name        VARCHAR(200) NOT NULL,
    vehicle_id          BIGINT       REFERENCES ntms.vehicle(vehicle_id),
    vehicle_no          VARCHAR(20),
    vehicle_type_id     BIGINT       REFERENCES ntms.vehicle_type(vehicle_type_id),
    driver_id           BIGINT       REFERENCES ntms.driver(driver_id),
    driver_name         VARCHAR(100),

    -- 운송 구간 (정산 명세서 표기용)
    from_location_name  VARCHAR(200),
    to_location_name    VARCHAR(200),
    from_zone_id        BIGINT       REFERENCES ntms.zone(zone_id),
    to_zone_id          BIGINT       REFERENCES ntms.zone(zone_id),

    -- 물량 실적
    order_count         INTEGER      NOT NULL DEFAULT 0,
    stop_count          SMALLINT     NOT NULL DEFAULT 0,
    completed_stop_count SMALLINT    NOT NULL DEFAULT 0,
    actual_qty          NUMERIC(14,3) NOT NULL DEFAULT 0,
    actual_weight_kg    ntms.d_weight_kg  NOT NULL DEFAULT 0,
    actual_volume_cbm   ntms.d_volume_cbm NOT NULL DEFAULT 0,
    actual_pallet_qty   NUMERIC(10,2) NOT NULL DEFAULT 0,

    -- 계획 대비 실적 (차이 분석)
    planned_distance_km ntms.d_distance,
    actual_distance_km  ntms.d_distance,
    distance_variance_km ntms.d_distance,                   -- 실적 - 계획
    planned_duration_min INTEGER,
    actual_duration_min INTEGER,
    empty_distance_km   ntms.d_distance,                    -- 공차 주행거리 (효율 지표)
    loading_rate        ntms.d_rate_pct,                    -- 적재율(%)

    -- 시간 실적
    actual_start_at     TIMESTAMPTZ,
    actual_end_at       TIMESTAMPTZ,
    waiting_minutes     INTEGER      NOT NULL DEFAULT 0,    -- 총 대기시간 (대기료 근거)
    delay_minutes       INTEGER      NOT NULL DEFAULT 0,

    -- 품질 지표
    on_time_pickup      BOOLEAN,                            -- 정시 상차
    on_time_delivery    BOOLEAN,                            -- 정시 납품
    pod_completed       BOOLEAN      NOT NULL DEFAULT false,-- 인수증 완비 여부
    exception_count     SMALLINT     NOT NULL DEFAULT 0,
    damage_count        SMALLINT     NOT NULL DEFAULT 0,

    -- 실비 (원가)
    fuel_consumed_liter NUMERIC(10,2),
    fuel_cost           ntms.d_amount,
    toll_fee            ntms.d_amount,
    other_cost          ntms.d_amount,

    -- 금액 (정산 산출 결과가 역기록됨)
    billing_amount      ntms.d_amount,                      -- 매출(화주 청구)
    payment_amount      ntms.d_amount,                      -- 매입(운송사 지급)
    margin_amount       ntms.d_amount,                      -- 마진
    margin_rate         ntms.d_rate_pct,

    -- 확정
    confirm_status      ntms.actual_confirm_status NOT NULL DEFAULT 'DRAFT',
    confirmed_at        TIMESTAMPTZ,
    confirmed_by        BIGINT,
    closed_at           TIMESTAMPTZ,
    reopened_at         TIMESTAMPTZ,
    reopen_reason       VARCHAR(500),

    -- 정산 연결
    billing_settlement_id BIGINT,                           -- 매출 정산 (11_settlement 정의 후 FK)
    payment_settlement_id BIGINT,                           -- 매입 정산
    billing_settled     BOOLEAN      NOT NULL DEFAULT false,
    payment_settled     BOOLEAN      NOT NULL DEFAULT false,

    remark              VARCHAR(1000),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_actual_no UNIQUE (tenant_id, actual_no),
    CONSTRAINT uk_actual_execution UNIQUE (execution_id)
);

CREATE INDEX ix_actual_date    ON ntms.transport_actual (tenant_id, actual_date, confirm_status);
CREATE INDEX ix_actual_carrier ON ntms.transport_actual (tenant_id, carrier_id, actual_date);
CREATE INDEX ix_actual_vehicle ON ntms.transport_actual (tenant_id, vehicle_id, actual_date);
CREATE INDEX ix_actual_driver  ON ntms.transport_actual (tenant_id, driver_id, actual_date);

-- 정산 대상 추출 (미정산 확정 실적)
CREATE INDEX ix_actual_unsettled_billing ON ntms.transport_actual (tenant_id, actual_date, carrier_id)
    WHERE confirm_status = 'CONFIRMED' AND billing_settled = false;
CREATE INDEX ix_actual_unsettled_payment ON ntms.transport_actual (tenant_id, actual_date, carrier_id)
    WHERE confirm_status = 'CONFIRMED' AND payment_settled = false;

COMMENT ON TABLE ntms.transport_actual IS '운송실적 헤더. CONFIRMED 상태만 정산 대상이며 계획 대비 차이를 함께 보관';

-- =====================================================================
-- 2. 오더별 실적 상세
--    트립 단위 실적을 오더 단위로 분해한다. 화주 청구의 최소 단위.
-- =====================================================================
CREATE TABLE ntms.actual_order (
    actual_order_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    actual_id           BIGINT       NOT NULL REFERENCES ntms.transport_actual(actual_id) ON DELETE CASCADE,
    order_id            BIGINT       NOT NULL REFERENCES ntms.transport_order(order_id),
    shipper_id          BIGINT       NOT NULL REFERENCES ntms.business_partner(partner_id),

    -- 인도 실적
    delivered_qty       NUMERIC(14,3) NOT NULL DEFAULT 0,
    delivered_weight_kg ntms.d_weight_kg  NOT NULL DEFAULT 0,
    delivered_volume_cbm ntms.d_volume_cbm NOT NULL DEFAULT 0,
    delivered_pallet_qty NUMERIC(10,2),
    damaged_qty         NUMERIC(14,3) NOT NULL DEFAULT 0,
    shortage_qty        NUMERIC(14,3) NOT NULL DEFAULT 0,
    returned_qty        NUMERIC(14,3) NOT NULL DEFAULT 0,
    delivery_result     ntms.pod_result NOT NULL DEFAULT 'NORMAL',
    delivered_at        TIMESTAMPTZ,

    -- 구간/거리 (오더 단위 안분)
    distance_km         ntms.d_distance,
    allocation_basis    VARCHAR(20),                        -- 안분 기준 WEIGHT/VOLUME/DISTANCE/EQUAL
    allocation_ratio    ntms.d_rate_pct,                    -- 트립 내 비중(%)

    -- 금액 (오더 단위 안분 결과)
    billing_amount      ntms.d_amount,
    payment_amount      ntms.d_amount,

    on_time_delivery    BOOLEAN,
    pod_id              BIGINT       REFERENCES ntms.pod(pod_id),
    remark              VARCHAR(500),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_actual_order UNIQUE (actual_id, order_id)
);

CREATE INDEX ix_actual_order_order   ON ntms.actual_order (tenant_id, order_id);
CREATE INDEX ix_actual_order_shipper ON ntms.actual_order (tenant_id, shipper_id, delivered_at DESC);

COMMENT ON TABLE ntms.actual_order IS '오더별 운송실적. 트립 실적을 오더 단위로 안분한 결과이며 화주 청구의 최소 단위';

-- =====================================================================
-- 3. 차량 운행일보
--    차량 단위 일별 집계. 가동률/연비/수익성 분석의 기준 데이터.
-- =====================================================================
CREATE TABLE ntms.vehicle_operation_daily (
    vehicle_operation_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    operation_date      DATE         NOT NULL,
    vehicle_id          BIGINT       NOT NULL REFERENCES ntms.vehicle(vehicle_id),
    driver_id           BIGINT       REFERENCES ntms.driver(driver_id),
    carrier_id          BIGINT       REFERENCES ntms.business_partner(partner_id),

    -- 주행
    start_odometer      NUMERIC(12,1),
    end_odometer        NUMERIC(12,1),
    total_distance_km   ntms.d_distance NOT NULL DEFAULT 0,
    loaded_distance_km  ntms.d_distance,                    -- 실차 주행
    empty_distance_km   ntms.d_distance,                    -- 공차 주행
    empty_rate          ntms.d_rate_pct,                    -- 공차율(%)

    -- 시간
    first_start_at      TIMESTAMPTZ,
    last_end_at         TIMESTAMPTZ,
    operating_minutes   INTEGER      NOT NULL DEFAULT 0,    -- 총 가동시간
    driving_minutes     INTEGER      NOT NULL DEFAULT 0,
    waiting_minutes     INTEGER      NOT NULL DEFAULT 0,
    idle_minutes        INTEGER      NOT NULL DEFAULT 0,    -- 공회전
    rest_minutes        INTEGER      NOT NULL DEFAULT 0,

    -- 실적
    trip_count          SMALLINT     NOT NULL DEFAULT 0,
    order_count         INTEGER      NOT NULL DEFAULT 0,
    stop_count          SMALLINT     NOT NULL DEFAULT 0,
    total_weight_kg     ntms.d_weight_kg NOT NULL DEFAULT 0,
    avg_loading_rate    ntms.d_rate_pct,

    -- 비용/수익
    fuel_liter          NUMERIC(10,2),
    fuel_cost           ntms.d_amount,
    fuel_efficiency     NUMERIC(6,2),                       -- 실연비(km/L)
    toll_fee            ntms.d_amount,
    other_cost          ntms.d_amount,
    revenue_amount      ntms.d_amount,                      -- 매출
    cost_amount         ntms.d_amount,                      -- 원가
    profit_amount       ntms.d_amount,

    is_operated         BOOLEAN      NOT NULL DEFAULT true, -- 가동 여부 (휴차 판정)
    non_operation_reason VARCHAR(100),                      -- 미가동 사유
    remark              VARCHAR(500),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_vehicle_operation UNIQUE (tenant_id, operation_date, vehicle_id)
);

CREATE INDEX ix_vehicle_operation_date ON ntms.vehicle_operation_daily (tenant_id, operation_date DESC);
CREATE INDEX ix_vehicle_operation_veh  ON ntms.vehicle_operation_daily (tenant_id, vehicle_id, operation_date DESC);

COMMENT ON TABLE ntms.vehicle_operation_daily IS '차량 일별 운행일보. 가동률/공차율/연비/수익성 분석의 기준';

-- =====================================================================
-- 4. 기사 근무 기록
--    화물자동차 운수사업법상 연속운전 제한 준수 여부를 관리한다.
-- =====================================================================
CREATE TABLE ntms.driver_work_log (
    driver_work_log_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    work_date           DATE         NOT NULL,
    driver_id           BIGINT       NOT NULL REFERENCES ntms.driver(driver_id),
    vehicle_id          BIGINT       REFERENCES ntms.vehicle(vehicle_id),
    carrier_id          BIGINT       REFERENCES ntms.business_partner(partner_id),

    work_start_at       TIMESTAMPTZ,
    work_end_at         TIMESTAMPTZ,
    total_work_minutes  INTEGER      NOT NULL DEFAULT 0,
    driving_minutes     INTEGER      NOT NULL DEFAULT 0,
    rest_minutes        INTEGER      NOT NULL DEFAULT 0,
    night_work_minutes  INTEGER      NOT NULL DEFAULT 0,    -- 야간 근무(22~06시)
    overtime_minutes    INTEGER      NOT NULL DEFAULT 0,

    max_continuous_driving_min INTEGER,                     -- 최장 연속 운전시간
    is_continuous_violation BOOLEAN NOT NULL DEFAULT false, -- 연속운전 제한 위반
    is_rest_violation   BOOLEAN      NOT NULL DEFAULT false,-- 휴게시간 미준수

    trip_count          SMALLINT     NOT NULL DEFAULT 0,
    order_count         INTEGER      NOT NULL DEFAULT 0,
    distance_km         ntms.d_distance NOT NULL DEFAULT 0,

    is_worked           BOOLEAN      NOT NULL DEFAULT true,
    absence_type        VARCHAR(20),                        -- 휴무/연차/병가
    remark              VARCHAR(500),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_driver_work_log UNIQUE (tenant_id, work_date, driver_id)
);

CREATE INDEX ix_driver_work_date ON ntms.driver_work_log (tenant_id, work_date DESC);
CREATE INDEX ix_driver_work_violation ON ntms.driver_work_log (tenant_id, work_date DESC)
    WHERE is_continuous_violation OR is_rest_violation;

COMMENT ON TABLE ntms.driver_work_log IS '기사 일별 근무 기록. 연속운전/휴게시간 법규 준수 관리';

-- =====================================================================
-- 5. KPI 일별 집계
--    다차원 집계를 단일 테이블에 담고, 차원이 NULL 이면 전체(합계)를 뜻한다.
--    aggregate_level 로 어느 차원의 집계인지 명시해 중복 합산을 방지한다.
-- =====================================================================
CREATE TABLE ntms.kpi_daily (
    kpi_daily_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    kpi_date            DATE         NOT NULL,
    aggregate_level     VARCHAR(20)  NOT NULL,              -- TOTAL/CARRIER/SHIPPER/ZONE/VEHICLE_TYPE

    -- 집계 차원 (해당 레벨이 아니면 NULL)
    carrier_id          BIGINT       REFERENCES ntms.business_partner(partner_id),
    shipper_id          BIGINT       REFERENCES ntms.business_partner(partner_id),
    zone_id             BIGINT       REFERENCES ntms.zone(zone_id),
    vehicle_type_id     BIGINT       REFERENCES ntms.vehicle_type(vehicle_type_id),

    -- 물동량
    order_count         INTEGER      NOT NULL DEFAULT 0,
    completed_count     INTEGER      NOT NULL DEFAULT 0,
    cancelled_count     INTEGER      NOT NULL DEFAULT 0,
    failed_count        INTEGER      NOT NULL DEFAULT 0,
    trip_count          INTEGER      NOT NULL DEFAULT 0,
    total_weight_kg     ntms.d_weight_kg  NOT NULL DEFAULT 0,
    total_volume_cbm    ntms.d_volume_cbm NOT NULL DEFAULT 0,
    total_distance_km   ntms.d_distance   NOT NULL DEFAULT 0,

    -- 품질
    on_time_pickup_count   INTEGER   NOT NULL DEFAULT 0,
    on_time_delivery_count INTEGER   NOT NULL DEFAULT 0,
    on_time_rate        ntms.d_rate_pct,                    -- 정시율(%)
    avg_delay_minutes   NUMERIC(10,2),
    exception_count     INTEGER      NOT NULL DEFAULT 0,
    accident_count      INTEGER      NOT NULL DEFAULT 0,
    damage_count        INTEGER      NOT NULL DEFAULT 0,
    pod_completion_rate ntms.d_rate_pct,                    -- 인수증 완료율(%)

    -- 효율
    avg_loading_rate    ntms.d_rate_pct,                    -- 평균 적재율(%)
    empty_rate          ntms.d_rate_pct,                    -- 공차율(%)
    vehicle_operating_count INTEGER  NOT NULL DEFAULT 0,
    vehicle_total_count INTEGER      NOT NULL DEFAULT 0,
    vehicle_utilization_rate ntms.d_rate_pct,               -- 가동률(%)
    avg_stop_per_trip   NUMERIC(8,2),

    -- 수익성
    billing_amount      ntms.d_amount NOT NULL DEFAULT 0,
    payment_amount      ntms.d_amount NOT NULL DEFAULT 0,
    margin_amount       ntms.d_amount NOT NULL DEFAULT 0,
    margin_rate         ntms.d_rate_pct,
    cost_per_km         ntms.d_unit_rate,
    revenue_per_trip    ntms.d_amount,

    calculated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT ck_kpi_level CHECK (
        aggregate_level IN ('TOTAL','CARRIER','SHIPPER','ZONE','VEHICLE_TYPE')
    )
);

CREATE UNIQUE INDEX ux_kpi_daily ON ntms.kpi_daily (
    tenant_id, kpi_date, aggregate_level,
    COALESCE(carrier_id, 0), COALESCE(shipper_id, 0),
    COALESCE(zone_id, 0), COALESCE(vehicle_type_id, 0)
);

CREATE INDEX ix_kpi_daily_date ON ntms.kpi_daily (tenant_id, kpi_date DESC, aggregate_level);

COMMENT ON TABLE ntms.kpi_daily IS '일별 KPI 집계 (배치 산출). aggregate_level 로 집계 차원을 구분해 중복 합산을 방지';
