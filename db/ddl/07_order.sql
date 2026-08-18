-- =====================================================================
-- NTMS : 07_order.sql
-- 운송오더 헤더 · 오더 품목 · 오더 상태이력 · 오더 참조처
--
-- 운송오더는 "화주가 요청한 운송 1건"을 뜻한다.
-- 계획(편성) 단계에서 여러 오더가 하나의 트립으로 묶이므로
-- 오더 자체는 차량/기사 정보를 갖지 않는다.
-- =====================================================================

SET search_path TO ntms, public;

-- =====================================================================
-- 1. 운송오더 헤더
-- =====================================================================
CREATE TABLE ntms.transport_order (
    order_id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    order_no            VARCHAR(30)  NOT NULL,              -- 운송오더번호 (fn_next_no)
    order_type          ntms.order_type NOT NULL DEFAULT 'DELIVERY',
    order_date          DATE         NOT NULL,              -- 오더 접수일자

    -- 외부 연계
    external_order_no   VARCHAR(50),                        -- 화주 시스템 오더번호
    source_system       VARCHAR(50),                        -- 유입 경로 (WEB/EXCEL/API/EDI/ERP)
    interface_log_id    BIGINT,                             -- 연계 수신 로그 참조

    -- 거래처
    shipper_id          BIGINT       NOT NULL REFERENCES ntms.business_partner(partner_id),  -- 화주
    contract_id         BIGINT       REFERENCES ntms.partner_contract(contract_id),
    consignor_id        BIGINT       REFERENCES ntms.business_partner(partner_id),  -- 송하인
    consignee_id        BIGINT       REFERENCES ntms.business_partner(partner_id),  -- 수하인
    shipper_dept_id     BIGINT       REFERENCES ntms.department(dept_id),           -- 화주측 귀속 부서
    sales_employee_id   BIGINT       REFERENCES ntms.employee(employee_id),

    -- 상차지 (마스터 변경에 영향받지 않도록 스냅샷 병행 보관)
    from_location_id    BIGINT       REFERENCES ntms.location(location_id),
    from_location_name  VARCHAR(200) NOT NULL,
    from_zip_code       VARCHAR(10),
    from_address1       VARCHAR(300) NOT NULL,
    from_address2       VARCHAR(300),
    from_latitude       ntms.d_latitude,
    from_longitude      ntms.d_longitude,
    from_region_code    VARCHAR(20),
    from_zone_id        BIGINT       REFERENCES ntms.zone(zone_id),
    from_contact_name   VARCHAR(100),
    from_contact_tel    VARCHAR(30),

    -- 하차지
    to_location_id      BIGINT       REFERENCES ntms.location(location_id),
    to_location_name    VARCHAR(200) NOT NULL,
    to_zip_code         VARCHAR(10),
    to_address1         VARCHAR(300) NOT NULL,
    to_address2         VARCHAR(300),
    to_latitude         ntms.d_latitude,
    to_longitude        ntms.d_longitude,
    to_region_code      VARCHAR(20),
    to_zone_id          BIGINT       REFERENCES ntms.zone(zone_id),
    to_contact_name     VARCHAR(100),
    to_contact_tel      VARCHAR(30),

    -- 희망 일시 (계획 수립의 시간 제약)
    appointment_type    ntms.appointment_type NOT NULL DEFAULT 'WINDOW',
    pickup_date         DATE,
    pickup_time_from    TIME,
    pickup_time_to      TIME,
    delivery_date       DATE,
    delivery_time_from  TIME,
    delivery_time_to    TIME,
    is_time_critical    BOOLEAN      NOT NULL DEFAULT false,-- 시간 엄수 (위약 대상)

    -- 화물 요약 (품목 라인 합계, 트리거/서비스로 동기화)
    total_item_count    INTEGER      NOT NULL DEFAULT 0,    -- 품목 라인 수
    total_qty           NUMERIC(14,3) NOT NULL DEFAULT 0,   -- 총 수량
    total_weight_kg     ntms.d_weight_kg  NOT NULL DEFAULT 0,
    total_volume_cbm    ntms.d_volume_cbm NOT NULL DEFAULT 0,
    total_pallet_qty    NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_package_qty   NUMERIC(14,3) NOT NULL DEFAULT 0,
    cargo_value         ntms.d_amount,                      -- 화물 가액 (보험/배상 기준)

    -- 운송 요구 조건 (배차 가능 차량 판정 기준)
    required_vehicle_type_id BIGINT  REFERENCES ntms.vehicle_type(vehicle_type_id),
    required_ton        NUMERIC(6,2),                       -- 요구 톤급
    required_body_type  ntms.vehicle_body_type,
    temperature_zone    ntms.temperature_zone NOT NULL DEFAULT 'AMBIENT',
    temperature_min     NUMERIC(5,2),
    temperature_max     NUMERIC(5,2),
    is_hazardous        BOOLEAN      NOT NULL DEFAULT false,
    requires_tail_lift  BOOLEAN      NOT NULL DEFAULT false,-- 파워게이트 필요
    requires_crane      BOOLEAN      NOT NULL DEFAULT false,
    is_exclusive        BOOLEAN      NOT NULL DEFAULT false,-- 독차 (혼적 불가)

    -- 거리/운임
    distance_km         ntms.d_distance,                    -- 산출 운송거리
    estimated_amount    ntms.d_amount,                      -- 예상 운임 (등록 시점 견적)
    freight_terms       ntms.freight_terms NOT NULL DEFAULT 'CREDIT',
    priority            ntms.order_priority NOT NULL DEFAULT 'NORMAL',

    -- 상태
    status              ntms.order_status NOT NULL DEFAULT 'RECEIVED',
    planned_qty         NUMERIC(14,3) NOT NULL DEFAULT 0,   -- 편성 반영 수량 (분할 배차 지원)
    delivered_qty       NUMERIC(14,3) NOT NULL DEFAULT 0,   -- 인도 완료 수량
    cancel_reason_code  VARCHAR(30),
    cancel_reason       VARCHAR(500),
    cancelled_at        TIMESTAMPTZ,
    cancelled_by        BIGINT,
    hold_reason         VARCHAR(500),

    -- 참조/지시
    reference_no1       VARCHAR(50),                        -- 화주 참조번호 (발주번호 등)
    reference_no2       VARCHAR(50),
    special_instruction VARCHAR(1000),                      -- 기사 전달 특이사항
    remark              VARCHAR(1000),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    deleted_at          TIMESTAMPTZ,
    deleted_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT ck_order_pickup_window CHECK (
        pickup_time_to IS NULL OR pickup_time_from IS NULL OR pickup_time_to >= pickup_time_from
    ),
    CONSTRAINT ck_order_delivery_window CHECK (
        delivery_time_to IS NULL OR delivery_time_from IS NULL OR delivery_time_to >= delivery_time_from
    ),
    CONSTRAINT ck_order_delivery_after_pickup CHECK (
        delivery_date IS NULL OR pickup_date IS NULL OR delivery_date >= pickup_date
    ),
    CONSTRAINT ck_order_qty_positive CHECK (total_qty >= 0 AND total_weight_kg >= 0 AND total_volume_cbm >= 0),
    CONSTRAINT ck_order_planned_qty CHECK (planned_qty >= 0 AND planned_qty <= total_qty + 0.001),
    CONSTRAINT ck_order_temp CHECK (
        temperature_min IS NULL OR temperature_max IS NULL OR temperature_min <= temperature_max
    )
);

CREATE UNIQUE INDEX ux_order_no ON ntms.transport_order (tenant_id, order_no) WHERE deleted_at IS NULL;

-- 외부 오더번호 중복 수신 차단 (연계 멱등성)
CREATE UNIQUE INDEX ux_order_external ON ntms.transport_order (tenant_id, source_system, external_order_no)
    WHERE external_order_no IS NOT NULL AND deleted_at IS NULL;

-- 배차 대기 목록 조회 (가장 빈번한 화면)
CREATE INDEX ix_order_pending ON ntms.transport_order (tenant_id, pickup_date, status)
    WHERE status IN ('RECEIVED','CONFIRMED') AND deleted_at IS NULL;

CREATE INDEX ix_order_shipper   ON ntms.transport_order (tenant_id, shipper_id, order_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX ix_order_status    ON ntms.transport_order (tenant_id, status, order_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX ix_order_pickup    ON ntms.transport_order (tenant_id, pickup_date, from_zone_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_order_delivery  ON ntms.transport_order (tenant_id, delivery_date, to_zone_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_order_from_loc  ON ntms.transport_order (tenant_id, from_location_id, pickup_date);
CREATE INDEX ix_order_to_loc    ON ntms.transport_order (tenant_id, to_location_id, delivery_date);
CREATE INDEX ix_order_reference ON ntms.transport_order (tenant_id, reference_no1) WHERE reference_no1 IS NOT NULL;

COMMENT ON TABLE ntms.transport_order IS '운송오더 헤더. 화주 요청 단위이며 차량/기사는 배차 단계에서 결정된다';

-- =====================================================================
-- 2. 운송오더 품목 라인
-- =====================================================================
CREATE TABLE ntms.transport_order_item (
    order_item_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    order_id            BIGINT       NOT NULL REFERENCES ntms.transport_order(order_id) ON DELETE CASCADE,
    line_no             INTEGER      NOT NULL,

    item_id             BIGINT       REFERENCES ntms.item(item_id),
    item_code           VARCHAR(50),                        -- 스냅샷
    item_name           VARCHAR(300) NOT NULL,              -- 스냅샷 (마스터 미등록 품목 허용)

    qty                 NUMERIC(14,3) NOT NULL,
    uom_code            VARCHAR(20)  NOT NULL DEFAULT 'EA',
    weight_kg           ntms.d_weight_kg  NOT NULL DEFAULT 0,
    volume_cbm          ntms.d_volume_cbm NOT NULL DEFAULT 0,
    packaging_type_id   BIGINT       REFERENCES ntms.packaging_type(packaging_type_id),
    package_qty         NUMERIC(14,3),                      -- 포장 단위 수량
    pallet_qty          NUMERIC(10,2),                      -- 파렛트 환산 수량

    -- 추적 정보
    lot_no              VARCHAR(50),
    serial_no           VARCHAR(50),
    manufacture_date    DATE,
    expiry_date         DATE,

    -- 취급 조건 (품목 마스터 override)
    temperature_zone    ntms.temperature_zone,
    is_hazardous        BOOLEAN      NOT NULL DEFAULT false,
    is_fragile          BOOLEAN      NOT NULL DEFAULT false,

    unit_price          ntms.d_unit_rate,                   -- 물품 단가
    amount              ntms.d_amount,                      -- 물품 가액 (배상 산정)

    -- 인도 실적 (실행 단계에서 갱신)
    delivered_qty       NUMERIC(14,3) NOT NULL DEFAULT 0,
    damaged_qty         NUMERIC(14,3) NOT NULL DEFAULT 0,
    shortage_qty        NUMERIC(14,3) NOT NULL DEFAULT 0,

    remark              VARCHAR(500),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_order_item_line UNIQUE (order_id, line_no),
    CONSTRAINT ck_order_item_qty CHECK (qty > 0),
    CONSTRAINT ck_order_item_delivered CHECK (delivered_qty >= 0 AND delivered_qty <= qty + 0.001)
);

CREATE INDEX ix_order_item_order ON ntms.transport_order_item (order_id, line_no);
CREATE INDEX ix_order_item_item  ON ntms.transport_order_item (tenant_id, item_id);
CREATE INDEX ix_order_item_lot   ON ntms.transport_order_item (tenant_id, lot_no) WHERE lot_no IS NOT NULL;

COMMENT ON TABLE ntms.transport_order_item IS '운송오더 품목 라인. 마스터 미등록 화물도 수용하도록 명칭을 스냅샷 보관';

-- =====================================================================
-- 3. 오더 상태 이력
--    상태 전이는 반드시 이 테이블에 기록된다. 정산 분쟁의 1차 근거.
-- =====================================================================
CREATE TABLE ntms.order_status_history (
    order_status_history_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    order_id            BIGINT       NOT NULL REFERENCES ntms.transport_order(order_id) ON DELETE CASCADE,
    seq_no              INTEGER      NOT NULL,              -- 전이 순번
    from_status         ntms.order_status,                  -- NULL = 최초 생성
    to_status           ntms.order_status NOT NULL,
    changed_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    changed_by          BIGINT,
    change_source       VARCHAR(30)  NOT NULL DEFAULT 'MANUAL',  -- MANUAL/SYSTEM/API/APP/BATCH
    reason_code         VARCHAR(30),
    reason              VARCHAR(500),
    ref_type            VARCHAR(30),                        -- 유발 객체 (TRIP/DISPATCH/EXECUTION)
    ref_id              BIGINT,
    remark              VARCHAR(500),

    CONSTRAINT uk_order_status_seq UNIQUE (order_id, seq_no)
);

CREATE INDEX ix_order_status_hist ON ntms.order_status_history (order_id, changed_at DESC);
CREATE INDEX ix_order_status_hist_tenant ON ntms.order_status_history (tenant_id, changed_at DESC);

COMMENT ON TABLE ntms.order_status_history IS '오더 상태 전이 이력. 상태는 이 이력과 항상 일치해야 한다';

-- =====================================================================
-- 4. 오더 상태 전이 규칙
--    허용된 전이만 통과시키기 위한 참조 테이블.
--    애플리케이션 서비스 계층이 이 표를 조회해 검증한다.
-- =====================================================================
CREATE TABLE ntms.order_status_rule (
    order_status_rule_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    from_status         ntms.order_status NOT NULL,
    to_status           ntms.order_status NOT NULL,
    is_allowed          BOOLEAN      NOT NULL DEFAULT true,
    require_reason      BOOLEAN      NOT NULL DEFAULT false,-- 사유 입력 필수
    require_permission  VARCHAR(100),                       -- 필요 권한 코드
    description         VARCHAR(300),

    CONSTRAINT uk_order_status_rule UNIQUE (from_status, to_status)
);

COMMENT ON TABLE ntms.order_status_rule IS '오더 상태 전이 허용 규칙 (전역 공통). 서비스 계층이 검증에 사용';

INSERT INTO ntms.order_status_rule (from_status, to_status, require_reason, description) VALUES
    ('DRAFT',        'RECEIVED',     false, '임시저장 → 접수'),
    ('DRAFT',        'CANCELLED',    true,  '임시저장 취소'),
    ('RECEIVED',     'CONFIRMED',    false, '접수 → 확정(계획 대상 편입)'),
    ('RECEIVED',     'CANCELLED',    true,  '접수 취소'),
    ('RECEIVED',     'ON_HOLD',      true,  '접수 보류'),
    ('CONFIRMED',    'PLANNED',      false, '편성 완료'),
    ('CONFIRMED',    'CANCELLED',    true,  '확정 취소'),
    ('CONFIRMED',    'ON_HOLD',      true,  '확정 보류'),
    ('PLANNED',      'ALLOCATED',    false, '운송사 배정 완료'),
    ('PLANNED',      'CONFIRMED',    true,  '편성 해제'),
    ('PLANNED',      'CANCELLED',    true,  '편성 후 취소'),
    ('ALLOCATED',    'DISPATCHED',   false, '배차 완료'),
    ('ALLOCATED',    'PLANNED',      true,  '배정 취소'),
    ('ALLOCATED',    'CANCELLED',    true,  '배정 후 취소'),
    ('DISPATCHED',   'PICKED_UP',    false, '상차 완료'),
    ('DISPATCHED',   'ALLOCATED',    true,  '배차 취소'),
    ('DISPATCHED',   'CANCELLED',    true,  '배차 후 취소'),
    ('PICKED_UP',    'IN_TRANSIT',   false, '운송 개시'),
    ('PICKED_UP',    'RETURNED',     true,  '상차 후 반송'),
    ('IN_TRANSIT',   'DELIVERED',    false, '인도 완료'),
    ('IN_TRANSIT',   'FAILED',       true,  '배송 실패'),
    ('IN_TRANSIT',   'RETURNED',     true,  '운송 중 반송'),
    ('DELIVERED',    'CONFIRMED_POD',false, '인수증 확인'),
    ('DELIVERED',    'FAILED',       true,  '인도 후 이의 제기'),
    ('CONFIRMED_POD','SETTLED',      false, '정산 완료'),
    ('FAILED',       'DISPATCHED',   true,  '재배차'),
    ('ON_HOLD',      'RECEIVED',     true,  '보류 해제'),
    ('ON_HOLD',      'CANCELLED',    true,  '보류 후 취소'),
    ('RETURNED',     'SETTLED',      false, '반송 건 정산');

-- =====================================================================
-- 5. 오더 첨부/참조 문서
-- =====================================================================
CREATE TABLE ntms.order_document (
    order_document_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    order_id            BIGINT       NOT NULL REFERENCES ntms.transport_order(order_id) ON DELETE CASCADE,
    document_type       VARCHAR(30)  NOT NULL,              -- 거래명세서/포장명세서/위험물서류/통관서류
    document_no         VARCHAR(50),
    file_id             BIGINT       REFERENCES ntms.file_attachment(file_id),
    issued_date         DATE,
    remark              VARCHAR(300),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT
);

CREATE INDEX ix_order_document ON ntms.order_document (order_id, document_type);

COMMENT ON TABLE ntms.order_document IS '오더 관련 문서 (명세서/위험물서류/통관서류 등)';

-- 연계 로그 FK
ALTER TABLE ntms.transport_order
    ADD CONSTRAINT ck_order_interface_ref CHECK (
        interface_log_id IS NULL OR source_system IS NOT NULL
    );
