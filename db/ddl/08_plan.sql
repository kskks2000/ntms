-- =====================================================================
-- NTMS : 08_plan.sql
-- 운송계획 : 편성(Trip) · 정차지 · 배정(Allocation) · 입찰 · 배차(Dispatch)
--
-- 계획은 세 단계로 분리된다.
--   1) 편성 : 오더들을 하나의 운송 단위(trip)로 묶고 경로/정차지를 확정
--   2) 배정 : 편성된 트립을 어느 운송사가 수행할지 결정 (수락/거절 왕복)
--   3) 배차 : 실제 차량과 기사를 지정
-- 각 단계를 분리해야 재배정·차량교체 이력이 온전히 남는다.
-- =====================================================================

SET search_path TO ntms, public;

-- =====================================================================
-- 1. 최적화 실행 이력
--    자동 편성/배차 알고리즘의 실행 단위. 결과 추적과 재현에 사용한다.
-- =====================================================================
CREATE TABLE ntms.plan_optimization_run (
    optimization_run_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    run_type            VARCHAR(30)  NOT NULL,              -- CONSOLIDATION/ROUTING/ALLOCATION
    plan_date           DATE         NOT NULL,
    parameter           JSONB,                              -- 실행 파라미터 (제약조건/가중치)
    target_order_count  INTEGER,                            -- 대상 오더 수
    result_trip_count   INTEGER,                            -- 생성 트립 수
    total_distance_km   ntms.d_distance,
    total_cost          ntms.d_amount,
    avg_loading_rate    ntms.d_rate_pct,                    -- 평균 적재율(%)
    unassigned_count    INTEGER,                            -- 미배정 오더 수
    engine_version      VARCHAR(30),
    status              ntms.batch_status NOT NULL DEFAULT 'RUNNING',
    error_message       VARCHAR(2000),
    started_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    finished_at         TIMESTAMPTZ,
    elapsed_ms          INTEGER,
    executed_by         BIGINT,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX ix_optimization_run ON ntms.plan_optimization_run (tenant_id, plan_date DESC, run_type);

COMMENT ON TABLE ntms.plan_optimization_run IS '자동 편성/경로/배정 최적화 실행 이력';

-- =====================================================================
-- 2. 운송 편성 (Trip)
--    한 대의 차량이 수행하는 하나의 운행 단위.
-- =====================================================================
CREATE TABLE ntms.trip (
    trip_id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    trip_no             VARCHAR(30)  NOT NULL,              -- 편성번호 (fn_next_no)
    plan_date           DATE         NOT NULL,              -- 계획 일자
    trip_type           ntms.trip_type NOT NULL DEFAULT 'SINGLE',
    transport_mode      ntms.transport_mode NOT NULL DEFAULT 'ROAD',

    -- 요구 차량 조건 (배정/배차 필터)
    required_vehicle_type_id BIGINT  REFERENCES ntms.vehicle_type(vehicle_type_id),
    required_ton        NUMERIC(6,2),
    required_body_type  ntms.vehicle_body_type,
    temperature_zone    ntms.temperature_zone NOT NULL DEFAULT 'AMBIENT',
    is_hazardous        BOOLEAN      NOT NULL DEFAULT false,

    -- 경로 요약
    start_location_id   BIGINT       REFERENCES ntms.location(location_id),
    end_location_id     BIGINT       REFERENCES ntms.location(location_id),
    start_zone_id       BIGINT       REFERENCES ntms.zone(zone_id),
    end_zone_id         BIGINT       REFERENCES ntms.zone(zone_id),
    total_stop_count    SMALLINT     NOT NULL DEFAULT 0,    -- 정차지 수
    pickup_stop_count   SMALLINT     NOT NULL DEFAULT 0,
    delivery_stop_count SMALLINT     NOT NULL DEFAULT 0,
    total_order_count   INTEGER      NOT NULL DEFAULT 0,

    -- 물량 집계 (편성된 오더 합계)
    total_qty           NUMERIC(14,3) NOT NULL DEFAULT 0,
    total_weight_kg     ntms.d_weight_kg  NOT NULL DEFAULT 0,
    total_volume_cbm    ntms.d_volume_cbm NOT NULL DEFAULT 0,
    total_pallet_qty    NUMERIC(10,2) NOT NULL DEFAULT 0,
    weight_loading_rate ntms.d_rate_pct,                    -- 중량 적재율(%)
    volume_loading_rate ntms.d_rate_pct,                    -- 부피 적재율(%)

    -- 계획 수치
    planned_distance_km ntms.d_distance,
    planned_duration_min INTEGER,                           -- 총 소요시간(이동+작업)
    planned_start_at    TIMESTAMPTZ,                        -- 계획 출발
    planned_end_at      TIMESTAMPTZ,                        -- 계획 종료
    planned_toll_fee    ntms.d_amount,
    estimated_billing_amount ntms.d_amount,                 -- 예상 매출
    estimated_payment_amount ntms.d_amount,                 -- 예상 매입
    estimated_margin    ntms.d_amount,                      -- 예상 마진

    -- 상태
    status              ntms.trip_status NOT NULL DEFAULT 'DRAFT',
    planner_employee_id BIGINT       REFERENCES ntms.employee(employee_id),
    optimization_run_id BIGINT       REFERENCES ntms.plan_optimization_run(optimization_run_id),
    is_auto_generated   BOOLEAN      NOT NULL DEFAULT false,-- 시스템 자동 편성 여부

    confirmed_at        TIMESTAMPTZ,
    confirmed_by        BIGINT,
    cancel_reason       VARCHAR(500),
    cancelled_at        TIMESTAMPTZ,
    cancelled_by        BIGINT,
    remark              VARCHAR(1000),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    deleted_at          TIMESTAMPTZ,
    deleted_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT ck_trip_period CHECK (planned_end_at IS NULL OR planned_start_at IS NULL OR planned_end_at >= planned_start_at)
);

CREATE UNIQUE INDEX ux_trip_no ON ntms.trip (tenant_id, trip_no) WHERE deleted_at IS NULL;
CREATE INDEX ix_trip_plan_date ON ntms.trip (tenant_id, plan_date, status) WHERE deleted_at IS NULL;
CREATE INDEX ix_trip_status    ON ntms.trip (tenant_id, status, plan_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX ix_trip_zone      ON ntms.trip (tenant_id, plan_date, start_zone_id, end_zone_id);
CREATE INDEX ix_trip_optimization ON ntms.trip (optimization_run_id) WHERE optimization_run_id IS NOT NULL;

COMMENT ON TABLE ntms.trip IS '운송 편성(트립). 차량 1대가 수행하는 운행 단위이며 다수 오더를 포함할 수 있다';

-- =====================================================================
-- 3. 편성-오더 매핑
--    분할 배차(오더 일부만 이번 트립에 실림)를 지원하기 위해 수량을 갖는다.
-- =====================================================================
CREATE TABLE ntms.trip_order (
    trip_order_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    trip_id             BIGINT       NOT NULL REFERENCES ntms.trip(trip_id) ON DELETE CASCADE,
    order_id            BIGINT       NOT NULL REFERENCES ntms.transport_order(order_id),
    seq_no              SMALLINT     NOT NULL DEFAULT 1,    -- 트립 내 오더 순번

    -- 분할 배차 수량 (NULL 이면 오더 전량)
    assigned_qty        NUMERIC(14,3),
    assigned_weight_kg  ntms.d_weight_kg,
    assigned_volume_cbm ntms.d_volume_cbm,
    assigned_pallet_qty NUMERIC(10,2),
    is_partial          BOOLEAN      NOT NULL DEFAULT false,-- 분할 여부

    -- 오더별 운임 배분 (트립 운임을 오더에 안분한 결과)
    allocated_billing_amount ntms.d_amount,
    allocated_payment_amount ntms.d_amount,
    allocation_basis    VARCHAR(20),                        -- WEIGHT/VOLUME/DISTANCE/EQUAL/MANUAL

    remark              VARCHAR(500),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_trip_order UNIQUE (trip_id, order_id),
    CONSTRAINT ck_trip_order_qty CHECK (assigned_qty IS NULL OR assigned_qty > 0)
);

CREATE INDEX ix_trip_order_order ON ntms.trip_order (tenant_id, order_id);
CREATE INDEX ix_trip_order_trip  ON ntms.trip_order (trip_id, seq_no);

COMMENT ON TABLE ntms.trip_order IS '편성-오더 매핑. 분할 배차 및 트립 운임의 오더별 안분 결과 보관';

-- =====================================================================
-- 4. 정차지 (경로 순서)
-- =====================================================================
CREATE TABLE ntms.trip_stop (
    trip_stop_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    trip_id             BIGINT       NOT NULL REFERENCES ntms.trip(trip_id) ON DELETE CASCADE,
    stop_seq            SMALLINT     NOT NULL,              -- 방문 순서 (1부터)
    stop_type           ntms.stop_type NOT NULL,

    -- 장소 (스냅샷 병행)
    location_id         BIGINT       REFERENCES ntms.location(location_id),
    location_name       VARCHAR(200) NOT NULL,
    zip_code            VARCHAR(10),
    address1            VARCHAR(300) NOT NULL,
    address2            VARCHAR(300),
    latitude            ntms.d_latitude,
    longitude           ntms.d_longitude,
    region_code         VARCHAR(20),
    contact_name        VARCHAR(100),
    contact_tel         VARCHAR(30),
    dock_id             BIGINT       REFERENCES ntms.location_dock(dock_id),  -- 배정 도크

    -- 계획 시각
    planned_arrival_at  TIMESTAMPTZ,
    planned_departure_at TIMESTAMPTZ,
    planned_service_min SMALLINT,                           -- 계획 작업시간(분)
    time_window_from    TIMESTAMPTZ,                        -- 방문 허용 시작
    time_window_to      TIMESTAMPTZ,                        -- 방문 허용 종료

    -- 구간 정보 (직전 정차지 기준)
    distance_from_prev_km ntms.d_distance,
    duration_from_prev_min INTEGER,
    toll_fee_from_prev  ntms.d_amount,

    -- 해당 정차지 처리 물량
    load_qty            NUMERIC(14,3) NOT NULL DEFAULT 0,   -- 상차 수량
    unload_qty          NUMERIC(14,3) NOT NULL DEFAULT 0,   -- 하차 수량
    load_weight_kg      ntms.d_weight_kg NOT NULL DEFAULT 0,
    unload_weight_kg    ntms.d_weight_kg NOT NULL DEFAULT 0,
    cumulative_weight_kg ntms.d_weight_kg,                  -- 출발 후 누적 적재중량 (과적 검증)
    cumulative_volume_cbm ntms.d_volume_cbm,

    status              ntms.stop_status NOT NULL DEFAULT 'PENDING',
    special_instruction VARCHAR(1000),
    remark              VARCHAR(500),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_trip_stop_seq UNIQUE (trip_id, stop_seq),
    CONSTRAINT ck_trip_stop_window CHECK (
        time_window_to IS NULL OR time_window_from IS NULL OR time_window_to >= time_window_from
    )
);

CREATE INDEX ix_trip_stop_trip     ON ntms.trip_stop (trip_id, stop_seq);
CREATE INDEX ix_trip_stop_location ON ntms.trip_stop (tenant_id, location_id, planned_arrival_at);

COMMENT ON TABLE ntms.trip_stop IS '트립 정차지. 방문 순서와 시간창을 보관하며 실행 단계에서 실적과 대조된다';

-- ---------------------------------------------------------------------
-- 정차지별 상/하차 오더 매핑
--   어느 정차지에서 어떤 오더(품목)를 싣고 내리는지 지정한다.
--   순회(milk-run) 배송에서 필수.
-- ---------------------------------------------------------------------
CREATE TABLE ntms.trip_stop_order (
    trip_stop_order_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    trip_stop_id        BIGINT       NOT NULL REFERENCES ntms.trip_stop(trip_stop_id) ON DELETE CASCADE,
    trip_id             BIGINT       NOT NULL REFERENCES ntms.trip(trip_id) ON DELETE CASCADE,
    order_id            BIGINT       NOT NULL REFERENCES ntms.transport_order(order_id),
    order_item_id       BIGINT       REFERENCES ntms.transport_order_item(order_item_id),
    action_type         VARCHAR(10)  NOT NULL,              -- LOAD / UNLOAD
    qty                 NUMERIC(14,3) NOT NULL,
    weight_kg           ntms.d_weight_kg NOT NULL DEFAULT 0,
    volume_cbm          ntms.d_volume_cbm NOT NULL DEFAULT 0,
    pallet_qty          NUMERIC(10,2),
    remark              VARCHAR(300),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,

    CONSTRAINT ck_trip_stop_order_action CHECK (action_type IN ('LOAD','UNLOAD')),
    CONSTRAINT ck_trip_stop_order_qty CHECK (qty > 0)
);

CREATE INDEX ix_trip_stop_order_stop  ON ntms.trip_stop_order (trip_stop_id);
CREATE INDEX ix_trip_stop_order_order ON ntms.trip_stop_order (tenant_id, order_id);

COMMENT ON TABLE ntms.trip_stop_order IS '정차지별 상/하차 대상 오더. 순회 배송의 작업 지시 근거';

-- =====================================================================
-- 5. 배정 (운송사 지정)
--    재배정을 지원하기 위해 트립당 여러 건이 생길 수 있으며
--    유효한 배정은 ACCEPTED 상태 1건뿐이다.
-- =====================================================================
CREATE TABLE ntms.allocation (
    allocation_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    trip_id             BIGINT       NOT NULL REFERENCES ntms.trip(trip_id) ON DELETE CASCADE,
    allocation_seq      SMALLINT     NOT NULL DEFAULT 1,    -- 배정 차수 (재배정 시 증가)
    carrier_id          BIGINT       NOT NULL REFERENCES ntms.business_partner(partner_id),
    allocation_type     ntms.allocation_type NOT NULL DEFAULT 'DIRECT',

    -- 배정 운임 (매입 기준)
    rate_table_id       BIGINT       REFERENCES ntms.rate_table(rate_table_id),
    allocated_amount    ntms.d_amount,                      -- 배정 운임
    surcharge_amount    ntms.d_amount NOT NULL DEFAULT 0,
    total_amount        ntms.d_amount,
    currency_code       CHAR(3)      NOT NULL DEFAULT 'KRW',
    is_negotiated       BOOLEAN      NOT NULL DEFAULT false,-- 협의 운임 여부 (표준요율 미적용)

    -- 요청/응답
    status              ntms.allocation_status NOT NULL DEFAULT 'REQUESTED',
    requested_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    requested_by        BIGINT,
    respond_deadline_at TIMESTAMPTZ,                        -- 수락 기한
    responded_at        TIMESTAMPTZ,
    responded_by        BIGINT,
    reject_reason_code  VARCHAR(30),
    reject_reason       VARCHAR(500),
    cancel_reason       VARCHAR(500),
    cancelled_at        TIMESTAMPTZ,
    cancelled_by        BIGINT,

    bid_id              BIGINT,                             -- 입찰 낙찰 참조 (아래 정의 후 FK)
    remark              VARCHAR(1000),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_allocation_seq UNIQUE (trip_id, allocation_seq)
);

-- 한 트립에 유효(수락)한 배정은 1건만 존재해야 한다
CREATE UNIQUE INDEX ux_allocation_accepted ON ntms.allocation (trip_id)
    WHERE status = 'ACCEPTED';

CREATE INDEX ix_allocation_carrier  ON ntms.allocation (tenant_id, carrier_id, status, requested_at DESC);
CREATE INDEX ix_allocation_pending  ON ntms.allocation (tenant_id, respond_deadline_at)
    WHERE status = 'REQUESTED';

COMMENT ON TABLE ntms.allocation IS '운송사 배정. 재배정 시 allocation_seq 를 증가시켜 이력을 보존한다';

-- =====================================================================
-- 6. 입찰 (경쟁 배정)
-- =====================================================================
CREATE TABLE ntms.carrier_bid (
    bid_id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    trip_id             BIGINT       NOT NULL REFERENCES ntms.trip(trip_id) ON DELETE CASCADE,
    bid_round           SMALLINT     NOT NULL DEFAULT 1,    -- 입찰 회차
    carrier_id          BIGINT       NOT NULL REFERENCES ntms.business_partner(partner_id),
    bid_amount          ntms.d_amount NOT NULL,
    currency_code       CHAR(3)      NOT NULL DEFAULT 'KRW',
    available_vehicle_id BIGINT      REFERENCES ntms.vehicle(vehicle_id),  -- 제시 차량
    comment             VARCHAR(500),
    status              ntms.bid_status NOT NULL DEFAULT 'SUBMITTED',
    submitted_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    submitted_by        BIGINT,
    decided_at          TIMESTAMPTZ,
    decided_by          BIGINT,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_carrier_bid UNIQUE (trip_id, bid_round, carrier_id),
    CONSTRAINT ck_bid_amount CHECK (bid_amount >= 0)
);

CREATE INDEX ix_bid_trip    ON ntms.carrier_bid (trip_id, bid_round, bid_amount);
CREATE INDEX ix_bid_carrier ON ntms.carrier_bid (tenant_id, carrier_id, submitted_at DESC);

COMMENT ON TABLE ntms.carrier_bid IS '운송사 입찰 내역 (경쟁 배정 방식)';

ALTER TABLE ntms.allocation
    ADD CONSTRAINT fk_allocation_bid FOREIGN KEY (bid_id) REFERENCES ntms.carrier_bid(bid_id);

-- =====================================================================
-- 7. 배차 (차량/기사 지정)
-- =====================================================================
CREATE TABLE ntms.dispatch (
    dispatch_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    dispatch_no         VARCHAR(30)  NOT NULL,              -- 배차번호 (fn_next_no)
    trip_id             BIGINT       NOT NULL REFERENCES ntms.trip(trip_id),
    allocation_id       BIGINT       REFERENCES ntms.allocation(allocation_id),
    dispatch_date       DATE         NOT NULL,
    dispatch_type       ntms.dispatch_type NOT NULL DEFAULT 'CONTRACTED',

    -- 수행 주체 (스냅샷 병행 — 마스터가 바뀌어도 배차 시점 정보를 보존)
    carrier_id          BIGINT       NOT NULL REFERENCES ntms.business_partner(partner_id),
    carrier_name        VARCHAR(200) NOT NULL,
    vehicle_id          BIGINT       REFERENCES ntms.vehicle(vehicle_id),
    vehicle_no          VARCHAR(20),
    vehicle_type_id     BIGINT       REFERENCES ntms.vehicle_type(vehicle_type_id),
    vehicle_type_name   VARCHAR(100),
    driver_id           BIGINT       REFERENCES ntms.driver(driver_id),
    driver_name         VARCHAR(100),
    driver_mobile       VARCHAR(30),
    sub_driver_id       BIGINT       REFERENCES ntms.driver(driver_id),  -- 부기사(장거리 2인 승무)
    sub_driver_name     VARCHAR(100),

    -- 계획 시각
    planned_start_at    TIMESTAMPTZ,
    planned_end_at      TIMESTAMPTZ,

    -- 상태
    status              ntms.dispatch_status NOT NULL DEFAULT 'ASSIGNED',
    dispatched_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    dispatcher_employee_id BIGINT    REFERENCES ntms.employee(employee_id),
    notified_at         TIMESTAMPTZ,                        -- 기사 통보 시각
    accepted_at         TIMESTAMPTZ,                        -- 기사 수락 시각
    rejected_at         TIMESTAMPTZ,
    reject_reason       VARCHAR(500),
    confirmed_at        TIMESTAMPTZ,
    confirmed_by        BIGINT,
    cancel_reason_code  VARCHAR(30),
    cancel_reason       VARCHAR(500),
    cancelled_at        TIMESTAMPTZ,
    cancelled_by        BIGINT,

    -- 배차 운임 (배정 운임에서 조정될 수 있음)
    dispatch_amount     ntms.d_amount,
    remark              VARCHAR(1000),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    deleted_at          TIMESTAMPTZ,
    deleted_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT ck_dispatch_period CHECK (
        planned_end_at IS NULL OR planned_start_at IS NULL OR planned_end_at >= planned_start_at
    ),
    CONSTRAINT ck_dispatch_sub_driver CHECK (sub_driver_id IS NULL OR sub_driver_id <> driver_id)
);

CREATE UNIQUE INDEX ux_dispatch_no ON ntms.dispatch (tenant_id, dispatch_no) WHERE deleted_at IS NULL;

-- 한 트립에 유효한 배차는 1건 (취소분 제외)
CREATE UNIQUE INDEX ux_dispatch_active_trip ON ntms.dispatch (trip_id)
    WHERE status <> 'CANCELLED' AND deleted_at IS NULL;

CREATE INDEX ix_dispatch_date    ON ntms.dispatch (tenant_id, dispatch_date, status) WHERE deleted_at IS NULL;
CREATE INDEX ix_dispatch_vehicle ON ntms.dispatch (tenant_id, vehicle_id, dispatch_date DESC);
CREATE INDEX ix_dispatch_driver  ON ntms.dispatch (tenant_id, driver_id, dispatch_date DESC);
CREATE INDEX ix_dispatch_carrier ON ntms.dispatch (tenant_id, carrier_id, dispatch_date DESC);
CREATE INDEX ix_dispatch_status  ON ntms.dispatch (tenant_id, status, dispatch_date DESC);

COMMENT ON TABLE ntms.dispatch IS '배차. 차량/기사/운송사 정보를 배차 시점 기준으로 스냅샷 보관';

-- ---------------------------------------------------------------------
-- 배차 변경 이력 (차량 교체 / 기사 교체 / 취소)
-- ---------------------------------------------------------------------
CREATE TABLE ntms.dispatch_history (
    dispatch_history_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    dispatch_id         BIGINT       NOT NULL REFERENCES ntms.dispatch(dispatch_id) ON DELETE CASCADE,
    seq_no              INTEGER      NOT NULL,
    change_type         ntms.dispatch_change_type NOT NULL,
    before_status       ntms.dispatch_status,
    after_status        ntms.dispatch_status,
    before_vehicle_id   BIGINT,
    after_vehicle_id    BIGINT,
    before_driver_id    BIGINT,
    after_driver_id     BIGINT,
    before_carrier_id   BIGINT,
    after_carrier_id    BIGINT,
    before_amount       ntms.d_amount,
    after_amount        ntms.d_amount,
    reason_code         VARCHAR(30),
    reason              VARCHAR(500),
    changed_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    changed_by          BIGINT,
    change_source       VARCHAR(30)  NOT NULL DEFAULT 'MANUAL',

    CONSTRAINT uk_dispatch_history_seq UNIQUE (dispatch_id, seq_no)
);

CREATE INDEX ix_dispatch_history ON ntms.dispatch_history (dispatch_id, changed_at DESC);

COMMENT ON TABLE ntms.dispatch_history IS '배차 변경 이력. 차량/기사 교체와 취소 사유를 추적';

-- =====================================================================
-- 8. 차량 가용성 (배차 충돌 방지)
--    배차 확정 시 해당 차량의 점유 구간을 기록해 이중 배차를 차단한다.
-- =====================================================================
CREATE TABLE ntms.vehicle_availability (
    vehicle_availability_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    vehicle_id          BIGINT       NOT NULL REFERENCES ntms.vehicle(vehicle_id),
    occupied_period     TSTZRANGE    NOT NULL,              -- 점유 구간
    reason_type         VARCHAR(20)  NOT NULL,              -- DISPATCH/MAINTENANCE/HOLIDAY/RESERVED
    dispatch_id         BIGINT       REFERENCES ntms.dispatch(dispatch_id) ON DELETE CASCADE,
    maintenance_id      BIGINT       REFERENCES ntms.vehicle_maintenance(maintenance_id) ON DELETE CASCADE,
    remark              VARCHAR(300),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,

    CONSTRAINT ck_vehicle_avail_reason CHECK (reason_type IN ('DISPATCH','MAINTENANCE','HOLIDAY','RESERVED'))
);

-- 동일 차량의 점유 구간이 겹치면 거부한다 (이중 배차 원천 차단)
ALTER TABLE ntms.vehicle_availability
    ADD CONSTRAINT ex_vehicle_availability
    EXCLUDE USING gist (
        vehicle_id WITH =,
        occupied_period WITH &&
    );

CREATE INDEX ix_vehicle_avail ON ntms.vehicle_availability (tenant_id, vehicle_id, occupied_period);

COMMENT ON TABLE ntms.vehicle_availability IS '차량 점유 구간. GiST 배제제약으로 이중 배차를 DB 레벨에서 차단';
