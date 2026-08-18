-- =====================================================================
-- NTMS : 06_rate.sql
-- 운임표 · 운임 상세 · 부대비용 유형 · 유류할증
--
-- 운임 체계는 매출(BILLING, 화주 청구)과 매입(PAYMENT, 운송사 지급)을
-- 동일 구조로 관리한다. 하나의 운송건에 두 개의 운임표가 각각 적용되며
-- 그 차이가 마진이 된다.
-- =====================================================================

SET search_path TO ntms, public;

-- =====================================================================
-- 1. 운임표 헤더
-- =====================================================================
CREATE TABLE ntms.rate_table (
    rate_table_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    rate_table_code     VARCHAR(30)  NOT NULL,
    rate_table_name     VARCHAR(200) NOT NULL,
    rate_target         ntms.rate_target NOT NULL,          -- BILLING(매출) / PAYMENT(매입)
    rate_method         ntms.rate_method NOT NULL,          -- 산출 방식
    partner_id          BIGINT       REFERENCES ntms.business_partner(partner_id),  -- NULL = 공통 운임표
    contract_id         BIGINT       REFERENCES ntms.partner_contract(contract_id),
    currency_code       CHAR(3)      NOT NULL DEFAULT 'KRW',

    -- 적용 기간 (기간 중복은 아래 EXCLUDE 제약으로 차단)
    apply_start_date    DATE         NOT NULL,
    apply_end_date      DATE,

    -- 공통 산출 옵션
    min_charge_amount   ntms.d_amount,                      -- 최저 청구금액
    round_unit          INTEGER      NOT NULL DEFAULT 1,    -- 절사 단위 (10원/100원)
    round_method        VARCHAR(10)  NOT NULL DEFAULT 'ROUND',  -- ROUND/FLOOR/CEIL
    include_toll        BOOLEAN      NOT NULL DEFAULT false,-- 통행료 운임 포함 여부
    apply_fuel_surcharge BOOLEAN     NOT NULL DEFAULT false,-- 유류할증 적용 여부
    is_taxable          BOOLEAN      NOT NULL DEFAULT true, -- 과세 여부

    -- 승인 (운임 변경은 승인 대상)
    status              ntms.approval_status NOT NULL DEFAULT 'DRAFT',
    requested_by        BIGINT,
    requested_at        TIMESTAMPTZ,
    approved_by         BIGINT,
    approved_at         TIMESTAMPTZ,
    reject_reason       VARCHAR(500),

    version_no          INTEGER      NOT NULL DEFAULT 1,    -- 개정 차수
    prev_rate_table_id  BIGINT       REFERENCES ntms.rate_table(rate_table_id),  -- 이전 버전
    description         VARCHAR(1000),
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    deleted_at          TIMESTAMPTZ,
    deleted_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_rate_table UNIQUE (tenant_id, rate_table_code, version_no),
    CONSTRAINT ck_rate_period CHECK (apply_end_date IS NULL OR apply_end_date >= apply_start_date),
    CONSTRAINT ck_rate_round CHECK (round_method IN ('ROUND','FLOOR','CEIL'))
);

CREATE INDEX ix_rate_table_lookup ON ntms.rate_table
    (tenant_id, rate_target, partner_id, apply_start_date DESC)
    WHERE status = 'APPROVED' AND is_active;

COMMENT ON TABLE ntms.rate_table IS '운임표 헤더. 매출/매입을 동일 구조로 관리하며 개정 시 version_no 를 올린다';

-- 동일 거래처·동일 용도의 운임표 적용기간이 겹치지 않도록 강제
ALTER TABLE ntms.rate_table
    ADD CONSTRAINT ex_rate_table_period
    EXCLUDE USING gist (
        tenant_id WITH =,
        rate_target WITH =,
        (COALESCE(partner_id, 0)) WITH =,
        rate_table_code WITH =,
        (daterange(apply_start_date, COALESCE(apply_end_date, DATE '9999-12-31'), '[]')) WITH &&
    )
    WHERE (status = 'APPROVED' AND deleted_at IS NULL);

-- =====================================================================
-- 2. 운임표 상세 (구간/조건별 단가)
--    조건 컬럼이 NULL 이면 "제한 없음"으로 해석한다.
--    다중 행이 매칭되면 priority 가 낮은 행을 우선 적용한다.
-- =====================================================================
CREATE TABLE ntms.rate_table_detail (
    rate_detail_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    rate_table_id       BIGINT       NOT NULL REFERENCES ntms.rate_table(rate_table_id) ON DELETE CASCADE,
    line_no             INTEGER      NOT NULL,

    -- 매칭 조건 (구간)
    from_zone_id        BIGINT       REFERENCES ntms.zone(zone_id),
    to_zone_id          BIGINT       REFERENCES ntms.zone(zone_id),
    from_location_id    BIGINT       REFERENCES ntms.location(location_id),
    to_location_id      BIGINT       REFERENCES ntms.location(location_id),
    from_region_code    VARCHAR(20)  REFERENCES ntms.region(region_code),
    to_region_code      VARCHAR(20)  REFERENCES ntms.region(region_code),
    vehicle_type_id     BIGINT       REFERENCES ntms.vehicle_type(vehicle_type_id),
    item_category_id    BIGINT       REFERENCES ntms.item_category(category_id),
    temperature_zone    ntms.temperature_zone,

    -- 매칭 조건 (수치 구간, 하한 이상 ~ 상한 미만)
    distance_from       ntms.d_distance,
    distance_to         ntms.d_distance,
    weight_from         ntms.d_weight_kg,
    weight_to           ntms.d_weight_kg,
    volume_from         ntms.d_volume_cbm,
    volume_to           ntms.d_volume_cbm,
    qty_from            NUMERIC(14,3),
    qty_to              NUMERIC(14,3),
    stop_count_from     SMALLINT,
    stop_count_to       SMALLINT,

    -- 단가
    base_amount         ntms.d_amount   NOT NULL DEFAULT 0, -- 기본 운임 (정액분)
    unit_rate           ntms.d_unit_rate,                   -- 단위당 단가 (km/kg/cbm/pallet 등)
    min_amount          ntms.d_amount,                      -- 최저 적용액
    max_amount          ntms.d_amount,                      -- 최고 적용액
    return_rate_pct     ntms.d_rate_pct,                    -- 회차(공차) 운임률(%)
    extra_stop_amount   ntms.d_amount,                      -- 경유지 1개소당 추가운임
    waiting_free_min    SMALLINT,                           -- 무료 대기시간(분)
    waiting_rate_hour   ntms.d_amount,                      -- 초과 대기 시간당 요금

    priority            SMALLINT     NOT NULL DEFAULT 100,  -- 낮을수록 우선 적용
    remark              VARCHAR(500),
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_rate_detail_line UNIQUE (rate_table_id, line_no),
    CONSTRAINT ck_rate_detail_distance CHECK (distance_to IS NULL OR distance_from IS NULL OR distance_to >= distance_from),
    CONSTRAINT ck_rate_detail_weight   CHECK (weight_to   IS NULL OR weight_from   IS NULL OR weight_to   >= weight_from),
    CONSTRAINT ck_rate_detail_volume   CHECK (volume_to   IS NULL OR volume_from   IS NULL OR volume_to   >= volume_from)
);

CREATE INDEX ix_rate_detail_table ON ntms.rate_table_detail (rate_table_id, priority, line_no) WHERE is_active;
CREATE INDEX ix_rate_detail_zone  ON ntms.rate_table_detail (rate_table_id, from_zone_id, to_zone_id) WHERE is_active;
CREATE INDEX ix_rate_detail_vtype ON ntms.rate_table_detail (rate_table_id, vehicle_type_id) WHERE is_active;

COMMENT ON TABLE ntms.rate_table_detail IS '운임표 상세. 조건 컬럼 NULL = 제한없음, 다중 매칭 시 priority 우선';

-- =====================================================================
-- 3. 부대비용 유형
-- =====================================================================
CREATE TABLE ntms.surcharge_type (
    surcharge_type_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    surcharge_code      VARCHAR(30)  NOT NULL,              -- WAITING/EXTRA_STOP/HANDLING/TOLL/ISLAND ...
    surcharge_name      VARCHAR(100) NOT NULL,
    charge_method       ntms.charge_method NOT NULL,        -- 산출 방식
    rate_target         ntms.rate_target,                   -- NULL = 매출/매입 공통
    default_amount      ntms.d_amount,                      -- 기본 금액 (정액)
    default_unit_rate   ntms.d_unit_rate,                   -- 기본 단가
    default_rate_pct    ntms.d_rate_pct,                    -- 기본 비율(%)
    is_taxable          BOOLEAN      NOT NULL DEFAULT true,
    require_evidence    BOOLEAN      NOT NULL DEFAULT false,-- 증빙 첨부 필수
    require_approval    BOOLEAN      NOT NULL DEFAULT false,-- 승인 필수
    auto_calculate      BOOLEAN      NOT NULL DEFAULT false,-- 시스템 자동 산출 (대기료 등)
    gl_account_code     VARCHAR(30),                        -- 회계 계정 코드 (ERP 연계)
    sort_order          INTEGER      NOT NULL DEFAULT 0,
    description         VARCHAR(500),
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_surcharge_type UNIQUE (tenant_id, surcharge_code)
);

COMMENT ON TABLE ntms.surcharge_type IS '부대비용 유형 정의 (대기료/경유료/하역비/통행료/도서산간할증 등)';

-- =====================================================================
-- 4. 유류할증
--    월별 기준유가 대비 변동분을 운임에 가산한다.
-- =====================================================================
CREATE TABLE ntms.fuel_surcharge (
    fuel_surcharge_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    rate_target         ntms.rate_target NOT NULL,
    partner_id          BIGINT       REFERENCES ntms.business_partner(partner_id),  -- NULL = 전체 적용
    vehicle_type_id     BIGINT       REFERENCES ntms.vehicle_type(vehicle_type_id),
    fuel_type           ntms.fuel_type NOT NULL DEFAULT 'DIESEL',

    apply_year_month    CHAR(6)      NOT NULL,              -- YYYYMM
    apply_start_date    DATE         NOT NULL,
    apply_end_date      DATE,

    base_fuel_price     ntms.d_unit_rate NOT NULL,          -- 기준 유가 (원/L)
    actual_fuel_price   ntms.d_unit_rate NOT NULL,          -- 당월 실제 유가
    surcharge_rate_pct  ntms.d_rate_pct,                    -- 운임 대비 할증률(%)
    surcharge_amount    ntms.d_amount,                      -- 정액 할증
    surcharge_per_km    ntms.d_unit_rate,                   -- km당 할증

    status              ntms.approval_status NOT NULL DEFAULT 'DRAFT',
    approved_by         BIGINT,
    approved_at         TIMESTAMPTZ,
    remark              VARCHAR(500),
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT ck_fuel_ym CHECK (apply_year_month ~ '^[0-9]{6}$')
);

CREATE INDEX ix_fuel_surcharge_lookup ON ntms.fuel_surcharge
    (tenant_id, rate_target, apply_year_month, partner_id)
    WHERE status = 'APPROVED' AND is_active;

COMMENT ON TABLE ntms.fuel_surcharge IS '유류할증 기준. 월별 유가 변동을 운임에 반영';

-- ---------------------------------------------------------------------
-- 운임표 참조 FK (마스터 정의 완료 후 부여)
-- ---------------------------------------------------------------------
ALTER TABLE ntms.shipper_info
    ADD CONSTRAINT fk_shipper_rate_table
    FOREIGN KEY (default_rate_table_id) REFERENCES ntms.rate_table(rate_table_id);

ALTER TABLE ntms.carrier_info
    ADD CONSTRAINT fk_carrier_rate_table
    FOREIGN KEY (default_rate_table_id) REFERENCES ntms.rate_table(rate_table_id);

ALTER TABLE ntms.partner_contract
    ADD CONSTRAINT fk_contract_rate_table
    FOREIGN KEY (rate_table_id) REFERENCES ntms.rate_table(rate_table_id);
