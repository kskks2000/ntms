-- =====================================================================
-- NTMS : 03_master_org.sql
-- 조직 · 거래처(화주/운송사) · 계약 · 행정구역 · 권역 · 거점 · 구간거리
-- =====================================================================

SET search_path TO ntms, public;

-- =====================================================================
-- 1. 부서 / 사원
-- =====================================================================
CREATE TABLE ntms.department (
    dept_id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    dept_code           VARCHAR(30)  NOT NULL,              -- 부서코드
    dept_name           VARCHAR(100) NOT NULL,
    dept_name_en        VARCHAR(100),
    parent_dept_id      BIGINT       REFERENCES ntms.department(dept_id),
    dept_level          SMALLINT     NOT NULL DEFAULT 1,
    dept_path           VARCHAR(500),                       -- 계층 경로 (/1/5/12) 조회 최적화
    manager_employee_id BIGINT,                             -- 부서장
    cost_center_code    VARCHAR(30),                        -- 코스트센터 (원가귀속)
    sort_order          INTEGER      NOT NULL DEFAULT 0,
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    deleted_at          TIMESTAMPTZ,
    deleted_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX ux_department_code ON ntms.department (tenant_id, dept_code) WHERE deleted_at IS NULL;
CREATE INDEX ix_department_parent ON ntms.department (parent_dept_id);

COMMENT ON TABLE ntms.department IS '부서 마스터 (계층형)';

CREATE TABLE ntms.employee (
    employee_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    employee_no         VARCHAR(30)  NOT NULL,              -- 사번
    employee_name       VARCHAR(100) NOT NULL,
    employee_name_en    VARCHAR(100),
    dept_id             BIGINT       REFERENCES ntms.department(dept_id),
    position_name       VARCHAR(50),                        -- 직위 (과장/차장)
    job_title           VARCHAR(50),                        -- 직책 (팀장/파트장)
    job_role            VARCHAR(50),                        -- 담당업무 (배차/정산/영업)
    email               VARCHAR(200),
    mobile              VARCHAR(30),
    tel                 VARCHAR(30),
    hire_date           DATE,
    resign_date         DATE,
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    deleted_at          TIMESTAMPTZ,
    deleted_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX ux_employee_no ON ntms.employee (tenant_id, employee_no) WHERE deleted_at IS NULL;
CREATE INDEX ix_employee_dept ON ntms.employee (tenant_id, dept_id) WHERE is_active;

COMMENT ON TABLE ntms.employee IS '사원 마스터 (배차담당/정산담당/영업담당 지정에 사용)';

ALTER TABLE ntms.department
    ADD CONSTRAINT fk_department_manager
    FOREIGN KEY (manager_employee_id) REFERENCES ntms.employee(employee_id);

-- =====================================================================
-- 2. 거래처 (화주 / 운송사 / 수하처 통합 마스터)
--    하나의 법인이 화주이면서 운송사일 수 있으므로 역할을 플래그로 관리한다.
-- =====================================================================
CREATE TABLE ntms.business_partner (
    partner_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    partner_code        VARCHAR(30)  NOT NULL,              -- 거래처 코드
    partner_name        VARCHAR(200) NOT NULL,
    partner_name_en     VARCHAR(200),
    partner_short_name  VARCHAR(50),                        -- 약칭 (화면 표시용)

    -- 역할 (복수 가능)
    is_shipper          BOOLEAN      NOT NULL DEFAULT false,-- 화주
    is_carrier          BOOLEAN      NOT NULL DEFAULT false,-- 운송사
    is_consignee        BOOLEAN      NOT NULL DEFAULT false,-- 수하처
    is_vendor           BOOLEAN      NOT NULL DEFAULT false,-- 일반 매입처

    -- 사업자 정보
    business_no         ntms.d_biz_no,
    corp_no             ntms.d_corp_no,
    ceo_name            VARCHAR(100),
    biz_type            VARCHAR(100),                       -- 업태
    biz_item            VARCHAR(100),                       -- 종목
    tax_type            VARCHAR(20)  NOT NULL DEFAULT 'TAXABLE',  -- TAXABLE/EXEMPT/ZERO_RATE

    -- 주소/연락
    zip_code            VARCHAR(10),
    address1            VARCHAR(300),
    address2            VARCHAR(300),
    latitude            ntms.d_latitude,
    longitude           ntms.d_longitude,
    region_code         VARCHAR(20),                        -- 행정구역 코드
    tel                 VARCHAR(30),
    fax                 VARCHAR(30),
    email               VARCHAR(200),
    manager_name        VARCHAR(100),                       -- 담당자
    manager_tel         VARCHAR(30),
    manager_email       VARCHAR(200),

    -- 계층 (본사-지점)
    parent_partner_id   BIGINT       REFERENCES ntms.business_partner(partner_id),

    -- 정산 기본값
    settlement_cycle    VARCHAR(20)  DEFAULT 'MONTHLY',     -- MONTHLY/SEMI_MONTHLY/WEEKLY
    closing_day         SMALLINT,                           -- 마감일 (1~31, 31=말일)
    payment_terms_days  SMALLINT,                           -- 결제 조건 (마감 후 N일)
    credit_limit        ntms.d_amount,                      -- 여신 한도
    bank_code           VARCHAR(10),
    bank_name           VARCHAR(50),
    account_no          VARCHAR(50),                        -- 계좌번호 (암호화 저장 권장)
    account_holder      VARCHAR(100),

    grade               ntms.partner_grade,                 -- 평가 등급
    sales_employee_id   BIGINT       REFERENCES ntms.employee(employee_id),  -- 영업담당
    remark              VARCHAR(1000),
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    deleted_at          TIMESTAMPTZ,
    deleted_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT ck_partner_role CHECK (is_shipper OR is_carrier OR is_consignee OR is_vendor),
    CONSTRAINT ck_partner_closing_day CHECK (closing_day IS NULL OR closing_day BETWEEN 1 AND 31)
);

CREATE UNIQUE INDEX ux_partner_code ON ntms.business_partner (tenant_id, partner_code) WHERE deleted_at IS NULL;
CREATE INDEX ix_partner_bizno   ON ntms.business_partner (tenant_id, business_no);
CREATE INDEX ix_partner_shipper ON ntms.business_partner (tenant_id) WHERE is_shipper AND is_active;
CREATE INDEX ix_partner_carrier ON ntms.business_partner (tenant_id) WHERE is_carrier AND is_active;
CREATE INDEX ix_partner_name_trgm ON ntms.business_partner USING gin (partner_name gin_trgm_ops);

COMMENT ON TABLE ntms.business_partner IS '거래처 통합 마스터. 화주/운송사/수하처 역할을 플래그로 구분';

-- ---------------------------------------------------------------------
-- 화주 확장 정보
-- ---------------------------------------------------------------------
CREATE TABLE ntms.shipper_info (
    partner_id          BIGINT       PRIMARY KEY REFERENCES ntms.business_partner(partner_id) ON DELETE CASCADE,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    default_rate_table_id BIGINT,                           -- 기본 청구 운임표 (06_rate)
    invoice_unit        VARCHAR(20)  DEFAULT 'MONTHLY',     -- 계산서 발행 단위
    invoice_split_by    VARCHAR(20),                        -- 계산서 분리 기준 (SITE/DEPT/NONE)
    require_pod         BOOLEAN      NOT NULL DEFAULT true, -- 인수증 필수 여부
    pod_deadline_hours  SMALLINT,                           -- 인수증 등록 기한(시간)
    allow_partial_delivery BOOLEAN   NOT NULL DEFAULT true, -- 분할 배송 허용
    order_cutoff_time   TIME,                               -- 당일 오더 마감시각
    edi_vendor_code     VARCHAR(50),                        -- 화주 EDI 코드
    remark              VARCHAR(1000),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0
);

COMMENT ON TABLE ntms.shipper_info IS '화주 확장 정보 (business_partner 1:1)';

-- ---------------------------------------------------------------------
-- 운송사 확장 정보
-- ---------------------------------------------------------------------
CREATE TABLE ntms.carrier_info (
    partner_id          BIGINT       PRIMARY KEY REFERENCES ntms.business_partner(partner_id) ON DELETE CASCADE,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    license_no          VARCHAR(50),                        -- 화물자동차운송사업 허가번호
    license_type        VARCHAR(50),                        -- 일반/개별/용달
    license_issue_date  DATE,
    owned_vehicle_count INTEGER      NOT NULL DEFAULT 0,    -- 보유 차량 수
    default_rate_table_id BIGINT,                           -- 기본 지급 운임표 (06_rate)
    allocation_priority SMALLINT     NOT NULL DEFAULT 50,   -- 배정 우선순위 (낮을수록 우선)
    allocation_ratio    ntms.d_rate_pct,                    -- 물량 배분 비율(%)
    auto_allocation     BOOLEAN      NOT NULL DEFAULT false,-- 자동배정 대상 여부
    accept_deadline_min SMALLINT     NOT NULL DEFAULT 30,   -- 배정 수락 기한(분)

    -- 보험 (사고 발생 시 구상 근거)
    insurance_company   VARCHAR(100),
    insurance_policy_no VARCHAR(50),
    insurance_amount    ntms.d_amount,                      -- 보상 한도
    insurance_start_date DATE,
    insurance_expire_date DATE,

    -- 평가
    evaluation_score    NUMERIC(5,2),                       -- 종합 평가점수
    on_time_rate        ntms.d_rate_pct,                    -- 정시율(%)
    accident_count      INTEGER      NOT NULL DEFAULT 0,
    last_evaluated_at   TIMESTAMPTZ,
    remark              VARCHAR(1000),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0
);

CREATE INDEX ix_carrier_insurance_expire ON ntms.carrier_info (insurance_expire_date)
    WHERE insurance_expire_date IS NOT NULL;

COMMENT ON TABLE ntms.carrier_info IS '운송사 확장 정보 (business_partner 1:1). 배정 우선순위/보험/평가 관리';

-- =====================================================================
-- 3. 거래처 계약
-- =====================================================================
CREATE TABLE ntms.partner_contract (
    contract_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    partner_id          BIGINT       NOT NULL REFERENCES ntms.business_partner(partner_id),
    contract_no         VARCHAR(50)  NOT NULL,              -- 계약번호
    contract_name       VARCHAR(200) NOT NULL,
    contract_target     ntms.rate_target NOT NULL,          -- BILLING(화주계약) / PAYMENT(운송사계약)
    contract_type       VARCHAR(30),                        -- 기본/단가/연간/스팟
    start_date          DATE         NOT NULL,
    end_date            DATE,
    rate_table_id       BIGINT,                             -- 적용 운임표 (06_rate)
    settlement_cycle    VARCHAR(20),
    closing_day         SMALLINT,
    payment_terms_days  SMALLINT,
    contract_amount     ntms.d_amount,                      -- 계약 금액 (연간 등)
    guarantee_amount    ntms.d_amount,                      -- 이행보증금
    penalty_rate        ntms.d_rate_pct,                    -- 지체상금율(%)
    auto_renew          BOOLEAN      NOT NULL DEFAULT false,
    status              ntms.contract_status NOT NULL DEFAULT 'DRAFT',
    signed_at           DATE,
    terminated_at       DATE,
    terminate_reason    VARCHAR(500),
    file_id             BIGINT       REFERENCES ntms.file_attachment(file_id),  -- 계약서 원본
    remark              VARCHAR(1000),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    deleted_at          TIMESTAMPTZ,
    deleted_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT ck_contract_period CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE UNIQUE INDEX ux_contract_no ON ntms.partner_contract (tenant_id, contract_no) WHERE deleted_at IS NULL;
CREATE INDEX ix_contract_partner ON ntms.partner_contract (tenant_id, partner_id, status);
CREATE INDEX ix_contract_expire  ON ntms.partner_contract (tenant_id, end_date) WHERE status = 'ACTIVE';

COMMENT ON TABLE ntms.partner_contract IS '거래처 계약 (화주 청구계약 / 운송사 지급계약)';

-- =====================================================================
-- 4. 행정구역 / 권역
-- =====================================================================
CREATE TABLE ntms.region (
    region_code         VARCHAR(20)  PRIMARY KEY,           -- 법정동/행정동 코드
    region_name         VARCHAR(100) NOT NULL,
    sido_name           VARCHAR(50)  NOT NULL,              -- 시/도
    sigungu_name        VARCHAR(50),                        -- 시/군/구
    eupmyeondong_name   VARCHAR(50),                        -- 읍/면/동
    region_level        SMALLINT     NOT NULL,              -- 1=시도, 2=시군구, 3=읍면동
    parent_region_code  VARCHAR(20)  REFERENCES ntms.region(region_code),
    zip_code            VARCHAR(10),
    latitude            ntms.d_latitude,
    longitude           ntms.d_longitude,
    is_island           BOOLEAN      NOT NULL DEFAULT false,-- 도서지역 (할증 대상)
    is_mountain         BOOLEAN      NOT NULL DEFAULT false,-- 산간지역 (할증 대상)
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX ix_region_parent ON ntms.region (parent_region_code);
CREATE INDEX ix_region_sido   ON ntms.region (sido_name, sigungu_name);

COMMENT ON TABLE ntms.region IS '행정구역 표준 마스터 (전 테넌트 공용). 도서/산간 할증 판정 기준';

CREATE TABLE ntms.zone (
    zone_id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    zone_code           VARCHAR(30)  NOT NULL,              -- 권역 코드
    zone_name           VARCHAR(100) NOT NULL,
    zone_level          SMALLINT     NOT NULL DEFAULT 1,    -- 대권역/중권역/소권역
    parent_zone_id      BIGINT       REFERENCES ntms.zone(zone_id),
    zone_type           VARCHAR(30),                        -- DELIVERY/PICKUP/RATE (용도 구분)
    center_latitude     ntms.d_latitude,                    -- 권역 중심 좌표
    center_longitude    ntms.d_longitude,
    sort_order          INTEGER      NOT NULL DEFAULT 0,
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX ux_zone_code ON ntms.zone (tenant_id, zone_code);

COMMENT ON TABLE ntms.zone IS '운영 권역 마스터 (배차 구역 / 권역 운임 기준)';

CREATE TABLE ntms.zone_region (
    zone_id             BIGINT       NOT NULL REFERENCES ntms.zone(zone_id) ON DELETE CASCADE,
    region_code         VARCHAR(20)  NOT NULL REFERENCES ntms.region(region_code),
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    PRIMARY KEY (zone_id, region_code)
);

CREATE INDEX ix_zone_region_region ON ntms.zone_region (tenant_id, region_code);

COMMENT ON TABLE ntms.zone_region IS '권역-행정구역 매핑';

-- =====================================================================
-- 5. 거점 (상/하차지, 창고, 센터)
-- =====================================================================
CREATE TABLE ntms.location (
    location_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    location_code       VARCHAR(30)  NOT NULL,              -- 거점 코드
    location_name       VARCHAR(200) NOT NULL,
    location_name_en    VARCHAR(200),
    location_type       ntms.location_type NOT NULL,
    partner_id          BIGINT       REFERENCES ntms.business_partner(partner_id),  -- 소유/운영 거래처

    -- 주소/좌표
    zip_code            VARCHAR(10),
    address1            VARCHAR(300) NOT NULL,
    address2            VARCHAR(300),
    address_en          VARCHAR(500),
    region_code         VARCHAR(20)  REFERENCES ntms.region(region_code),
    zone_id             BIGINT       REFERENCES ntms.zone(zone_id),
    latitude            ntms.d_latitude,
    longitude           ntms.d_longitude,
    geo_verified        BOOLEAN      NOT NULL DEFAULT false,-- 좌표 검증 여부 (지오코딩 신뢰도)

    -- 연락
    tel                 VARCHAR(30),
    fax                 VARCHAR(30),
    manager_name        VARCHAR(100),
    manager_tel         VARCHAR(30),
    manager_email       VARCHAR(200),

    -- 운영 조건 (배차 계획 제약)
    open_time           TIME,                               -- 운영 시작
    close_time          TIME,                               -- 운영 종료
    break_start_time    TIME,                               -- 휴게 시작
    break_end_time      TIME,
    operating_days      VARCHAR(7)   DEFAULT '1111100',     -- 월~일 운영 여부 비트
    dock_count          SMALLINT,                           -- 도크 수
    max_vehicle_ton     NUMERIC(6,2),                       -- 진입 가능 최대 톤수
    allowed_body_types  ntms.vehicle_body_type[],           -- 진입 가능 차종
    standard_load_min   SMALLINT,                           -- 표준 상차 소요(분)
    standard_unload_min SMALLINT,                           -- 표준 하차 소요(분)
    require_reservation BOOLEAN      NOT NULL DEFAULT false,-- 도크 예약 필수
    has_forklift        BOOLEAN      NOT NULL DEFAULT false,
    entry_note          VARCHAR(1000),                      -- 진입 유의사항 (기사 안내)

    is_pickup_available   BOOLEAN    NOT NULL DEFAULT true, -- 상차지 사용 가능
    is_delivery_available BOOLEAN    NOT NULL DEFAULT true, -- 하차지 사용 가능
    remark              VARCHAR(1000),
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    deleted_at          TIMESTAMPTZ,
    deleted_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT ck_location_operating_days CHECK (operating_days ~ '^[01]{7}$')
);

CREATE UNIQUE INDEX ux_location_code ON ntms.location (tenant_id, location_code) WHERE deleted_at IS NULL;
CREATE INDEX ix_location_partner ON ntms.location (tenant_id, partner_id) WHERE is_active;
CREATE INDEX ix_location_zone    ON ntms.location (tenant_id, zone_id);
CREATE INDEX ix_location_region  ON ntms.location (tenant_id, region_code);
CREATE INDEX ix_location_geo     ON ntms.location (latitude, longitude) WHERE latitude IS NOT NULL;
CREATE INDEX ix_location_name_trgm ON ntms.location USING gin (location_name gin_trgm_ops);

COMMENT ON TABLE ntms.location IS '거점 마스터. 상/하차지 운영조건은 배차 계획의 제약조건으로 사용';

-- ---------------------------------------------------------------------
-- 도크 (상하차 버스)
-- ---------------------------------------------------------------------
CREATE TABLE ntms.location_dock (
    dock_id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    location_id         BIGINT       NOT NULL REFERENCES ntms.location(location_id) ON DELETE CASCADE,
    dock_no             VARCHAR(20)  NOT NULL,              -- 도크 번호
    dock_name           VARCHAR(100),
    dock_type           VARCHAR(20),                        -- LOADING/UNLOADING/BOTH
    allowed_body_types  ntms.vehicle_body_type[],
    max_vehicle_ton     NUMERIC(6,2),
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_location_dock UNIQUE (location_id, dock_no)
);

COMMENT ON TABLE ntms.location_dock IS '거점 도크. 도크 예약 및 상하차 슬롯 배정에 사용';

-- ---------------------------------------------------------------------
-- 거점 운영 캘린더 (휴무/특별 운영시간)
-- ---------------------------------------------------------------------
CREATE TABLE ntms.location_calendar (
    location_calendar_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    location_id         BIGINT       NOT NULL REFERENCES ntms.location(location_id) ON DELETE CASCADE,
    calendar_date       DATE         NOT NULL,
    is_holiday          BOOLEAN      NOT NULL DEFAULT false,-- 휴무 여부
    open_time           TIME,                               -- 특별 운영 시작
    close_time          TIME,
    remark              VARCHAR(300),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_location_calendar UNIQUE (location_id, calendar_date)
);

COMMENT ON TABLE ntms.location_calendar IS '거점별 휴무/특별 운영시간. 배송 가능일 판정에 사용';

-- =====================================================================
-- 6. 구간 거리 마스터
--    실측 도로거리를 보관해 운임 계산과 계획 수립의 기준으로 삼는다.
--    외부 라우팅 API 결과를 캐시하는 용도로도 사용한다.
-- =====================================================================
CREATE TABLE ntms.distance_master (
    distance_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    from_location_id    BIGINT       NOT NULL REFERENCES ntms.location(location_id),
    to_location_id      BIGINT       NOT NULL REFERENCES ntms.location(location_id),
    route_type          VARCHAR(20)  NOT NULL DEFAULT 'SHORTEST',  -- SHORTEST/FASTEST/FREE(무료도로)
    distance_km         ntms.d_distance NOT NULL,
    duration_minutes    INTEGER,                            -- 예상 소요시간
    toll_fee            ntms.d_amount,                      -- 통행료
    source              VARCHAR(30)  NOT NULL DEFAULT 'MANUAL',    -- MANUAL/API/ACTUAL
    api_provider        VARCHAR(50),                        -- 라우팅 API 제공자
    last_verified_at    TIMESTAMPTZ,                        -- 최종 검증 시각
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_distance_master UNIQUE (tenant_id, from_location_id, to_location_id, route_type),
    CONSTRAINT ck_distance_positive CHECK (distance_km >= 0),
    CONSTRAINT ck_distance_not_same CHECK (from_location_id <> to_location_id)
);

CREATE INDEX ix_distance_from ON ntms.distance_master (tenant_id, from_location_id) WHERE is_active;

COMMENT ON TABLE ntms.distance_master IS '거점 간 구간거리/소요시간/통행료. 운임 산출 및 계획 수립 기준';
