-- =====================================================================
-- NTMS : 09_execution.sql
-- 운송실행 : 실행 헤더 · 정차 실적 · 이벤트 · 인수증(POD) · 위치추적 · 예외
--
-- 계획(trip/dispatch)과 실행(execution)을 분리하는 이유:
--   계획은 "하기로 한 것", 실행은 "실제로 일어난 것"이다.
--   둘의 차이(지연/미방문/수량차이)가 실적과 정산의 근거가 된다.
-- =====================================================================

SET search_path TO ntms, public;

-- =====================================================================
-- 1. 운송실행 헤더 (배차 1건 : 실행 1건)
-- =====================================================================
CREATE TABLE ntms.transport_execution (
    execution_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    dispatch_id         BIGINT       NOT NULL REFERENCES ntms.dispatch(dispatch_id),
    trip_id             BIGINT       NOT NULL REFERENCES ntms.trip(trip_id),
    execution_date      DATE         NOT NULL,

    -- 수행 주체 (조회 성능을 위한 비정규화)
    carrier_id          BIGINT       NOT NULL REFERENCES ntms.business_partner(partner_id),
    vehicle_id          BIGINT       REFERENCES ntms.vehicle(vehicle_id),
    driver_id           BIGINT       REFERENCES ntms.driver(driver_id),

    -- 실제 운행
    actual_start_at     TIMESTAMPTZ,                        -- 실제 출발
    actual_end_at       TIMESTAMPTZ,                        -- 실제 종료
    start_odometer      NUMERIC(12,1),                      -- 출발 시 계기판
    end_odometer        NUMERIC(12,1),                      -- 종료 시 계기판
    actual_distance_km  ntms.d_distance,                    -- 실주행거리
    actual_duration_min INTEGER,                            -- 실소요시간
    driving_minutes     INTEGER,                            -- 순수 주행시간
    waiting_minutes     INTEGER      NOT NULL DEFAULT 0,    -- 총 대기시간 (대기료 산정)
    rest_minutes        INTEGER      NOT NULL DEFAULT 0,
    fuel_consumed_liter NUMERIC(10,2),
    toll_fee            ntms.d_amount,

    -- 진행 상태
    status              ntms.execution_status NOT NULL DEFAULT 'READY',
    current_stop_seq    SMALLINT,                           -- 현재 진행 정차지
    completed_stop_count SMALLINT    NOT NULL DEFAULT 0,
    total_stop_count    SMALLINT     NOT NULL DEFAULT 0,
    progress_rate       ntms.d_rate_pct,                    -- 진행률(%)

    -- 최종 위치 (관제 화면용 캐시 — 상세 궤적은 gps_log)
    last_latitude       ntms.d_latitude,
    last_longitude      ntms.d_longitude,
    last_location_at    TIMESTAMPTZ,
    last_speed_kmh      NUMERIC(6,2),

    -- 지연/이상
    delay_minutes       INTEGER      NOT NULL DEFAULT 0,    -- 계획 대비 지연(분)
    is_delayed          BOOLEAN      NOT NULL DEFAULT false,
    exception_count     SMALLINT     NOT NULL DEFAULT 0,

    completed_at        TIMESTAMPTZ,
    suspend_reason      VARCHAR(500),
    suspended_at        TIMESTAMPTZ,
    remark              VARCHAR(1000),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_execution_dispatch UNIQUE (dispatch_id),
    CONSTRAINT ck_execution_period CHECK (actual_end_at IS NULL OR actual_start_at IS NULL OR actual_end_at >= actual_start_at),
    CONSTRAINT ck_execution_odometer CHECK (end_odometer IS NULL OR start_odometer IS NULL OR end_odometer >= start_odometer)
);

CREATE INDEX ix_execution_date    ON ntms.transport_execution (tenant_id, execution_date, status);
CREATE INDEX ix_execution_vehicle ON ntms.transport_execution (tenant_id, vehicle_id, execution_date DESC);
CREATE INDEX ix_execution_driver  ON ntms.transport_execution (tenant_id, driver_id, execution_date DESC);
CREATE INDEX ix_execution_carrier ON ntms.transport_execution (tenant_id, carrier_id, execution_date DESC);
CREATE INDEX ix_execution_active  ON ntms.transport_execution (tenant_id, status)
    WHERE status IN ('DEPARTED','IN_TRANSIT','ARRIVED','UNLOADING');
CREATE INDEX ix_execution_trip    ON ntms.transport_execution (trip_id);

COMMENT ON TABLE ntms.transport_execution IS '운송실행 헤더. 배차 1건당 1건이며 실주행/대기/지연 실적을 집계';

-- =====================================================================
-- 2. 정차 실적 (계획 정차지 대비 실제)
-- =====================================================================
CREATE TABLE ntms.execution_stop (
    execution_stop_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    execution_id        BIGINT       NOT NULL REFERENCES ntms.transport_execution(execution_id) ON DELETE CASCADE,
    trip_stop_id        BIGINT       REFERENCES ntms.trip_stop(trip_stop_id),
    stop_seq            SMALLINT     NOT NULL,
    stop_type           ntms.stop_type NOT NULL,
    location_id         BIGINT       REFERENCES ntms.location(location_id),
    location_name       VARCHAR(200) NOT NULL,

    -- 계획 시각 (대조용 복사)
    planned_arrival_at  TIMESTAMPTZ,
    planned_departure_at TIMESTAMPTZ,

    -- 실제 시각
    actual_arrival_at   TIMESTAMPTZ,
    actual_departure_at TIMESTAMPTZ,
    service_start_at    TIMESTAMPTZ,                        -- 상/하차 작업 시작
    service_end_at      TIMESTAMPTZ,
    actual_service_min  SMALLINT,                           -- 실제 작업시간(분)
    waiting_minutes     SMALLINT     NOT NULL DEFAULT 0,    -- 도착~작업개시 대기(분) → 대기료 근거
    delay_minutes       INTEGER      NOT NULL DEFAULT 0,    -- 계획 대비 지연(분)
    is_on_time          BOOLEAN,                            -- 정시 도착 여부 (KPI)

    -- 도착 검증 (GPS 기반 부정 방지)
    arrival_latitude    ntms.d_latitude,
    arrival_longitude   ntms.d_longitude,
    arrival_distance_m  INTEGER,                            -- 목표 좌표와의 오차(m)
    is_geofence_verified BOOLEAN     NOT NULL DEFAULT false,

    -- 실제 처리 물량
    actual_load_qty     NUMERIC(14,3) NOT NULL DEFAULT 0,
    actual_unload_qty   NUMERIC(14,3) NOT NULL DEFAULT 0,
    actual_load_weight_kg   ntms.d_weight_kg NOT NULL DEFAULT 0,
    actual_unload_weight_kg ntms.d_weight_kg NOT NULL DEFAULT 0,

    status              ntms.stop_status NOT NULL DEFAULT 'PENDING',
    skip_reason_code    VARCHAR(30),
    skip_reason         VARCHAR(500),
    remark              VARCHAR(500),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_execution_stop_seq UNIQUE (execution_id, stop_seq),
    CONSTRAINT ck_execution_stop_time CHECK (
        actual_departure_at IS NULL OR actual_arrival_at IS NULL OR actual_departure_at >= actual_arrival_at
    )
);

CREATE INDEX ix_execution_stop_exec ON ntms.execution_stop (execution_id, stop_seq);
CREATE INDEX ix_execution_stop_loc  ON ntms.execution_stop (tenant_id, location_id, actual_arrival_at DESC);
CREATE INDEX ix_execution_stop_late ON ntms.execution_stop (tenant_id, is_on_time, actual_arrival_at DESC)
    WHERE is_on_time = false;

COMMENT ON TABLE ntms.execution_stop IS '정차 실적. 대기시간과 정시도착 여부가 정산·KPI 의 직접 근거';

-- =====================================================================
-- 3. 실행 이벤트 로그
--    기사앱/GPS/관제에서 들어오는 모든 상태 변화의 원장.
-- =====================================================================
CREATE TABLE ntms.execution_event (
    execution_event_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    execution_id        BIGINT       NOT NULL REFERENCES ntms.transport_execution(execution_id) ON DELETE CASCADE,
    execution_stop_id   BIGINT       REFERENCES ntms.execution_stop(execution_stop_id) ON DELETE CASCADE,
    event_type          ntms.execution_event_type NOT NULL,
    event_at            TIMESTAMPTZ  NOT NULL,              -- 이벤트 발생 시각 (단말 기준)
    received_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),-- 서버 수신 시각 (오프라인 보정 판단)
    latitude            ntms.d_latitude,
    longitude           ntms.d_longitude,
    accuracy_m          SMALLINT,
    source              ntms.gps_source NOT NULL DEFAULT 'MOBILE_APP',
    reported_by         BIGINT,                             -- 보고자 user_id
    device_id           VARCHAR(100),
    is_offline_sync     BOOLEAN      NOT NULL DEFAULT false,-- 오프라인 후 일괄 전송 여부
    payload             JSONB,                              -- 원본 페이로드 보존
    remark              VARCHAR(500),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX ix_execution_event_exec ON ntms.execution_event (execution_id, event_at);
CREATE INDEX ix_execution_event_type ON ntms.execution_event (tenant_id, event_type, event_at DESC);
CREATE INDEX ix_execution_event_stop ON ntms.execution_event (execution_stop_id, event_at);

COMMENT ON TABLE ntms.execution_event IS '운송 실행 이벤트 원장. 단말 시각과 서버 수신 시각을 함께 보관';

-- =====================================================================
-- 4. 인수증 (POD, Proof of Delivery)
-- =====================================================================
CREATE TABLE ntms.pod (
    pod_id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    execution_id        BIGINT       NOT NULL REFERENCES ntms.transport_execution(execution_id),
    execution_stop_id   BIGINT       REFERENCES ntms.execution_stop(execution_stop_id),
    order_id            BIGINT       NOT NULL REFERENCES ntms.transport_order(order_id),
    pod_no              VARCHAR(30),                        -- 인수증 번호
    pod_type            ntms.pod_type NOT NULL DEFAULT 'SIGNATURE',

    -- 인수자
    receiver_name       VARCHAR(100),
    receiver_relation   VARCHAR(50),                        -- 본인/가족/경비실/동료
    receiver_contact    VARCHAR(30),
    delivered_at        TIMESTAMPTZ  NOT NULL,

    -- 인수 결과
    pod_result          ntms.pod_result NOT NULL DEFAULT 'NORMAL',
    delivered_qty       NUMERIC(14,3) NOT NULL DEFAULT 0,
    damaged_qty         NUMERIC(14,3) NOT NULL DEFAULT 0,
    shortage_qty        NUMERIC(14,3) NOT NULL DEFAULT 0,
    returned_qty        NUMERIC(14,3) NOT NULL DEFAULT 0,
    abnormal_reason     VARCHAR(500),

    -- 증빙
    signature_file_id   BIGINT       REFERENCES ntms.file_attachment(file_id),
    photo_file_ids      BIGINT[],                           -- 현장 사진 (복수)
    pin_code            VARCHAR(10),                        -- 인증번호 방식일 때

    -- 위치 검증
    latitude            ntms.d_latitude,
    longitude           ntms.d_longitude,
    is_geofence_verified BOOLEAN     NOT NULL DEFAULT false,

    -- 확인
    is_confirmed        BOOLEAN      NOT NULL DEFAULT false,-- 화주 확인 여부
    confirmed_at        TIMESTAMPTZ,
    confirmed_by        BIGINT,
    dispute_reason      VARCHAR(500),                       -- 이의 사유
    remark              VARCHAR(500),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT ck_pod_qty CHECK (delivered_qty >= 0 AND damaged_qty >= 0 AND shortage_qty >= 0)
);

CREATE INDEX ix_pod_order     ON ntms.pod (tenant_id, order_id);
CREATE INDEX ix_pod_execution ON ntms.pod (execution_id);
CREATE INDEX ix_pod_delivered ON ntms.pod (tenant_id, delivered_at DESC);
CREATE INDEX ix_pod_abnormal  ON ntms.pod (tenant_id, pod_result, delivered_at DESC)
    WHERE pod_result <> 'NORMAL';
CREATE INDEX ix_pod_unconfirmed ON ntms.pod (tenant_id, delivered_at)
    WHERE is_confirmed = false;

COMMENT ON TABLE ntms.pod IS '인수증. 정산 청구의 필수 증빙이며 미확인 건은 청구 보류 대상';

-- =====================================================================
-- 5. 위치 추적 로그 (대용량 · 월 파티션)
--    수집 주기 30초 기준 차량 100대 → 월 약 800만 행.
--    파티션 + BRIN 인덱스로 관리하고 보존기간 경과 시 파티션 DROP.
-- =====================================================================
CREATE TABLE ntms.gps_log (
    gps_log_id          BIGINT GENERATED ALWAYS AS IDENTITY,
    tenant_id           BIGINT       NOT NULL,
    vehicle_id          BIGINT       NOT NULL,
    driver_id           BIGINT,
    execution_id        BIGINT,                             -- 운행 미배정 시 NULL (공차 이동)
    collected_at        TIMESTAMPTZ  NOT NULL,              -- 단말 수집 시각
    received_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    latitude            ntms.d_latitude  NOT NULL,
    longitude           ntms.d_longitude NOT NULL,
    altitude            NUMERIC(8,2),
    speed_kmh           NUMERIC(6,2),
    heading             SMALLINT,                           -- 진행 방위 (0~359)
    accuracy_m          SMALLINT,
    is_ignition_on      BOOLEAN,                            -- 시동 상태 (공회전 분석)
    odometer            NUMERIC(12,1),
    source              ntms.gps_source NOT NULL DEFAULT 'GPS_DEVICE',
    PRIMARY KEY (gps_log_id, collected_at),
    CONSTRAINT ck_gps_heading CHECK (heading IS NULL OR heading BETWEEN 0 AND 359)
) PARTITION BY RANGE (collected_at);

-- 시계열 대용량에는 BRIN 이 B-Tree 대비 인덱스 크기가 수백 배 작다
CREATE INDEX ix_gps_log_collected ON ntms.gps_log USING brin (collected_at) WITH (pages_per_range = 64);
CREATE INDEX ix_gps_log_vehicle   ON ntms.gps_log (vehicle_id, collected_at DESC);
CREATE INDEX ix_gps_log_execution ON ntms.gps_log (execution_id, collected_at) WHERE execution_id IS NOT NULL;

COMMENT ON TABLE ntms.gps_log IS '차량 위치 이력 (월 파티션). 보존기간 경과 파티션은 DROP 으로 정리';

-- =====================================================================
-- 6. 온도 이력 (콜드체인)
-- =====================================================================
CREATE TABLE ntms.temperature_log (
    temperature_log_id  BIGINT GENERATED ALWAYS AS IDENTITY,
    tenant_id           BIGINT       NOT NULL,
    vehicle_id          BIGINT       NOT NULL,
    execution_id        BIGINT,
    sensor_id           VARCHAR(50),                        -- 다구획 차량은 센서별 기록
    zone_no             SMALLINT,                           -- 적재함 구획 번호
    collected_at        TIMESTAMPTZ  NOT NULL,
    temperature         NUMERIC(5,2) NOT NULL,              -- 측정 온도(℃)
    humidity            NUMERIC(5,2),                       -- 습도(%)
    setpoint_min        NUMERIC(5,2),                       -- 설정 하한
    setpoint_max        NUMERIC(5,2),                       -- 설정 상한
    is_abnormal         BOOLEAN      NOT NULL DEFAULT false,-- 기준 이탈 여부
    PRIMARY KEY (temperature_log_id, collected_at)
) PARTITION BY RANGE (collected_at);

CREATE INDEX ix_temp_log_collected ON ntms.temperature_log USING brin (collected_at) WITH (pages_per_range = 64);
CREATE INDEX ix_temp_log_execution ON ntms.temperature_log (execution_id, collected_at);
CREATE INDEX ix_temp_log_abnormal  ON ntms.temperature_log (tenant_id, collected_at DESC) WHERE is_abnormal;

COMMENT ON TABLE ntms.temperature_log IS '냉장/냉동 화물 온도 이력 (월 파티션). 품질 클레임 대응 증빙';

-- =====================================================================
-- 7. 운송 예외 / 사고
-- =====================================================================
CREATE TABLE ntms.transport_exception (
    exception_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    exception_no        VARCHAR(30),                        -- 예외 관리번호
    execution_id        BIGINT       REFERENCES ntms.transport_execution(execution_id),
    execution_stop_id   BIGINT       REFERENCES ntms.execution_stop(execution_stop_id),
    order_id            BIGINT       REFERENCES ntms.transport_order(order_id),
    dispatch_id         BIGINT       REFERENCES ntms.dispatch(dispatch_id),
    vehicle_id          BIGINT       REFERENCES ntms.vehicle(vehicle_id),
    driver_id           BIGINT       REFERENCES ntms.driver(driver_id),
    carrier_id          BIGINT       REFERENCES ntms.business_partner(partner_id),

    exception_type      ntms.exception_type NOT NULL,
    severity            ntms.exception_severity NOT NULL DEFAULT 'MEDIUM',
    occurred_at         TIMESTAMPTZ  NOT NULL,
    latitude            ntms.d_latitude,
    longitude           ntms.d_longitude,
    location_desc       VARCHAR(300),
    description         VARCHAR(2000) NOT NULL,

    -- 영향
    impact_minutes      INTEGER,                            -- 지연 유발 시간
    affected_order_count INTEGER,
    damage_qty          NUMERIC(14,3),
    damage_amount       ntms.d_amount,                      -- 손해 추정액

    -- 처리
    action_taken        VARCHAR(2000),
    status              ntms.exception_status NOT NULL DEFAULT 'REPORTED',
    reported_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    reported_by         BIGINT,
    assigned_to         BIGINT,                             -- 처리 담당자
    resolved_at         TIMESTAMPTZ,
    resolved_by         BIGINT,
    closed_at           TIMESTAMPTZ,

    -- 책임/구상
    liability_party     VARCHAR(20),                        -- CARRIER/SHIPPER/CONSIGNEE/THIRD/NONE
    claim_amount        ntms.d_amount,                      -- 청구(구상) 금액
    is_insurance_claim  BOOLEAN      NOT NULL DEFAULT false,
    insurance_claim_no  VARCHAR(50),
    settlement_impact   BOOLEAN      NOT NULL DEFAULT false,-- 정산 조정 반영 여부

    photo_file_ids      BIGINT[],
    remark              VARCHAR(1000),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT ck_exception_liability CHECK (
        liability_party IS NULL OR liability_party IN ('CARRIER','SHIPPER','CONSIGNEE','THIRD','NONE')
    )
);

CREATE UNIQUE INDEX ux_exception_no ON ntms.transport_exception (tenant_id, exception_no)
    WHERE exception_no IS NOT NULL;
CREATE INDEX ix_exception_execution ON ntms.transport_exception (execution_id);
CREATE INDEX ix_exception_order     ON ntms.transport_exception (tenant_id, order_id);
CREATE INDEX ix_exception_open      ON ntms.transport_exception (tenant_id, status, occurred_at DESC)
    WHERE status IN ('REPORTED','INVESTIGATING','ACTION_TAKEN');
CREATE INDEX ix_exception_carrier   ON ntms.transport_exception (tenant_id, carrier_id, occurred_at DESC);

COMMENT ON TABLE ntms.transport_exception IS '운송 예외/사고. 책임 구분과 구상 금액은 정산 조정으로 연결된다';
