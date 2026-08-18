-- =====================================================================
-- NTMS : 04_master_fleet.sql
-- 차종 · 차량 · 정비 · 기사 · 차량기사배정
-- =====================================================================

SET search_path TO ntms, public;

-- =====================================================================
-- 1. 차종
-- =====================================================================
CREATE TABLE ntms.vehicle_type (
    vehicle_type_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    vehicle_type_code   VARCHAR(30)  NOT NULL,              -- 차종 코드 (예: WING_5T)
    vehicle_type_name   VARCHAR(100) NOT NULL,              -- 차종명 (예: 윙바디 5톤)
    body_type           ntms.vehicle_body_type NOT NULL,    -- 적재함 형태
    ton_class           NUMERIC(6,2) NOT NULL,              -- 톤급 (1.0 / 2.5 / 5.0 / 11.0 / 25.0)

    -- 적재 능력 (계획 수립 시 적재율 산정 기준)
    max_weight_kg       ntms.d_weight_kg,                   -- 최대 적재중량
    max_volume_cbm      ntms.d_volume_cbm,                  -- 최대 적재부피
    max_pallet_qty      SMALLINT,                           -- 최대 팔레트 수
    inner_length_mm     INTEGER,                            -- 적재함 내부 길이
    inner_width_mm      INTEGER,
    inner_height_mm     INTEGER,

    -- 온도 제어
    is_temperature_controlled BOOLEAN NOT NULL DEFAULT false,
    temperature_zone    ntms.temperature_zone,
    temperature_min     NUMERIC(5,2),                       -- 설정 가능 최저온도(℃)
    temperature_max     NUMERIC(5,2),

    axle_count          SMALLINT,                           -- 축수 (통행료/도로제한)
    is_hazmat_capable   BOOLEAN      NOT NULL DEFAULT false,-- 위험물 운송 가능
    has_tail_lift       BOOLEAN      NOT NULL DEFAULT false,-- 파워게이트
    has_crane           BOOLEAN      NOT NULL DEFAULT false,

    standard_fuel_efficiency NUMERIC(6,2),                  -- 표준 연비(km/L) - 원가 추정
    sort_order          INTEGER      NOT NULL DEFAULT 0,
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_vehicle_type UNIQUE (tenant_id, vehicle_type_code),
    CONSTRAINT ck_vehicle_type_temp CHECK (
        temperature_min IS NULL OR temperature_max IS NULL OR temperature_min <= temperature_max
    )
);

CREATE INDEX ix_vehicle_type_ton ON ntms.vehicle_type (tenant_id, ton_class, body_type) WHERE is_active;

COMMENT ON TABLE ntms.vehicle_type IS '차종 마스터. 적재능력은 편성(적재율) 및 배차 가능여부 판정 기준';

-- =====================================================================
-- 2. 차량
-- =====================================================================
CREATE TABLE ntms.vehicle (
    vehicle_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    vehicle_no          VARCHAR(20)  NOT NULL,              -- 차량번호 (예: 12가3456)
    vehicle_type_id     BIGINT       NOT NULL REFERENCES ntms.vehicle_type(vehicle_type_id),
    carrier_id          BIGINT       REFERENCES ntms.business_partner(partner_id),  -- 소속 운송사
    ownership_type      ntms.vehicle_ownership NOT NULL DEFAULT 'CONTRACTED',

    -- 차량 제원
    vin                 VARCHAR(30),                        -- 차대번호
    manufacturer        VARCHAR(50),
    model_name          VARCHAR(100),
    model_year          SMALLINT,
    registration_date   DATE,                               -- 등록일
    color               VARCHAR(30),

    -- 실제 적재 능력 (차종 기본값을 개별 차량이 override)
    max_weight_kg       ntms.d_weight_kg,
    max_volume_cbm      ntms.d_volume_cbm,
    max_pallet_qty      SMALLINT,
    tare_weight_kg      ntms.d_weight_kg,                   -- 공차중량

    -- 연료
    fuel_type           ntms.fuel_type NOT NULL DEFAULT 'DIESEL',
    fuel_efficiency     NUMERIC(6,2),                       -- 실측 연비(km/L)
    fuel_tank_liter     NUMERIC(7,2),
    fuel_card_no        VARCHAR(50),                        -- 유류카드 (실비 정산)

    -- 보험/검사 (만료 임박 알림 대상)
    insurance_company   VARCHAR(100),
    insurance_policy_no VARCHAR(50),
    insurance_start_date DATE,
    insurance_expire_date DATE,
    inspection_date     DATE,                               -- 최종 검사일
    next_inspection_date DATE,                              -- 차기 검사 만료일

    -- 장비
    gps_device_id       VARCHAR(50),                        -- GPS 단말 ID
    gps_provider        VARCHAR(50),                        -- 관제 사업자
    dtg_device_id       VARCHAR(50),                        -- 운행기록계(DTG) ID
    temperature_sensor_id VARCHAR(50),                      -- 온도센서 ID (콜드체인)

    -- 운영
    base_location_id    BIGINT       REFERENCES ntms.location(location_id),  -- 차고지
    default_driver_id   BIGINT,                             -- 기본 기사 (아래 driver 정의 후 FK 부여)
    default_zone_id     BIGINT       REFERENCES ntms.zone(zone_id),          -- 주 운행 권역
    status              ntms.vehicle_status NOT NULL DEFAULT 'AVAILABLE',
    current_odometer    NUMERIC(12,1),                      -- 현재 누적주행거리(km)
    last_operated_at    TIMESTAMPTZ,

    remark              VARCHAR(1000),
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    deleted_at          TIMESTAMPTZ,
    deleted_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX ux_vehicle_no ON ntms.vehicle (tenant_id, vehicle_no) WHERE deleted_at IS NULL;
CREATE INDEX ix_vehicle_carrier   ON ntms.vehicle (tenant_id, carrier_id, status) WHERE is_active;
CREATE INDEX ix_vehicle_type      ON ntms.vehicle (tenant_id, vehicle_type_id, status) WHERE is_active;
CREATE INDEX ix_vehicle_available ON ntms.vehicle (tenant_id, status) WHERE status = 'AVAILABLE' AND is_active;
CREATE INDEX ix_vehicle_gps       ON ntms.vehicle (gps_device_id) WHERE gps_device_id IS NOT NULL;
CREATE INDEX ix_vehicle_insurance_expire ON ntms.vehicle (tenant_id, insurance_expire_date)
    WHERE insurance_expire_date IS NOT NULL AND is_active;

COMMENT ON TABLE ntms.vehicle IS '차량 마스터. 직영/지입/계약/용차를 ownership_type 으로 구분';

-- ---------------------------------------------------------------------
-- 차량 정비 이력
-- ---------------------------------------------------------------------
CREATE TABLE ntms.vehicle_maintenance (
    maintenance_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    vehicle_id          BIGINT       NOT NULL REFERENCES ntms.vehicle(vehicle_id),
    maintenance_type    VARCHAR(30)  NOT NULL,              -- REGULAR/REPAIR/INSPECTION/TIRE/ACCIDENT
    maintenance_date    DATE         NOT NULL,
    odometer            NUMERIC(12,1),                      -- 정비 시점 주행거리
    vendor_name         VARCHAR(200),                       -- 정비업체
    cost_amount         ntms.d_amount,                      -- 정비 비용
    description         VARCHAR(1000),
    out_of_service_from TIMESTAMPTZ,                        -- 가동 중단 시작 (가용성 계산)
    out_of_service_to   TIMESTAMPTZ,
    next_maintenance_date DATE,
    next_maintenance_odometer NUMERIC(12,1),
    file_id             BIGINT       REFERENCES ntms.file_attachment(file_id),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0
);

CREATE INDEX ix_maintenance_vehicle ON ntms.vehicle_maintenance (tenant_id, vehicle_id, maintenance_date DESC);

COMMENT ON TABLE ntms.vehicle_maintenance IS '차량 정비 이력. 가동중단 구간은 배차 가용성 판정에 반영';

-- =====================================================================
-- 3. 기사
-- =====================================================================
CREATE TABLE ntms.driver (
    driver_id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    driver_code         VARCHAR(30)  NOT NULL,              -- 기사 코드
    driver_name         VARCHAR(100) NOT NULL,
    carrier_id          BIGINT       REFERENCES ntms.business_partner(partner_id),  -- 소속 운송사
    employee_id         BIGINT       REFERENCES ntms.employee(employee_id),         -- 직영 기사일 때

    -- 개인정보 (최소 수집 원칙 / 암호화 대상)
    birth_date          DATE,
    gender              CHAR(1),                            -- M/F
    mobile              VARCHAR(30),
    tel                 VARCHAR(30),
    email               VARCHAR(200),
    zip_code            VARCHAR(10),
    address1            VARCHAR(300),
    address2            VARCHAR(300),
    emergency_contact   VARCHAR(30),                        -- 비상연락처

    -- 면허/자격 (만료 임박 알림 대상)
    license_no          VARCHAR(50),
    license_type        VARCHAR(30),                        -- 1종대형/1종보통/특수
    license_issue_date  DATE,
    license_expire_date DATE,
    has_hazmat_license  BOOLEAN      NOT NULL DEFAULT false,-- 위험물 운송 자격
    has_forklift_license BOOLEAN     NOT NULL DEFAULT false,
    cargo_qualification_no VARCHAR(50),                     -- 화물운송종사자격증 번호
    cargo_qualification_expire_date DATE,

    -- 근무
    hire_date           DATE,
    resign_date         DATE,
    default_vehicle_id  BIGINT       REFERENCES ntms.vehicle(vehicle_id),
    default_zone_id     BIGINT       REFERENCES ntms.zone(zone_id),

    -- 정산 (지입/개별 기사 지급용)
    bank_code           VARCHAR(10),
    bank_name           VARCHAR(50),
    account_no          VARCHAR(50),                        -- 암호화 저장 권장
    account_holder      VARCHAR(100),

    -- 앱 연동
    app_user_id         BIGINT       REFERENCES ntms.user_account(user_id),  -- 기사앱 계정
    push_token          VARCHAR(500),
    last_app_active_at  TIMESTAMPTZ,

    -- 평가
    evaluation_score    NUMERIC(5,2),
    on_time_rate        ntms.d_rate_pct,
    accident_count      INTEGER      NOT NULL DEFAULT 0,

    status              ntms.driver_status NOT NULL DEFAULT 'ACTIVE',
    remark              VARCHAR(1000),
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    deleted_at          TIMESTAMPTZ,
    deleted_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT ck_driver_gender CHECK (gender IS NULL OR gender IN ('M','F'))
);

CREATE UNIQUE INDEX ux_driver_code ON ntms.driver (tenant_id, driver_code) WHERE deleted_at IS NULL;
CREATE INDEX ix_driver_carrier ON ntms.driver (tenant_id, carrier_id, status) WHERE is_active;
CREATE INDEX ix_driver_status  ON ntms.driver (tenant_id, status) WHERE is_active;
CREATE INDEX ix_driver_app     ON ntms.driver (app_user_id) WHERE app_user_id IS NOT NULL;
CREATE INDEX ix_driver_license_expire ON ntms.driver (tenant_id, license_expire_date)
    WHERE license_expire_date IS NOT NULL AND is_active;

COMMENT ON TABLE ntms.driver IS '기사 마스터. 개인정보 포함 테이블이므로 조회 권한과 다운로드 권한을 분리 통제할 것';

-- 차량의 기본 기사 FK (driver 정의 후 부여)
ALTER TABLE ntms.vehicle
    ADD CONSTRAINT fk_vehicle_default_driver
    FOREIGN KEY (default_driver_id) REFERENCES ntms.driver(driver_id);

-- user_account 의 기사 연결 FK
ALTER TABLE ntms.user_account
    ADD CONSTRAINT fk_user_driver
    FOREIGN KEY (driver_id) REFERENCES ntms.driver(driver_id);

ALTER TABLE ntms.user_account
    ADD CONSTRAINT fk_user_employee
    FOREIGN KEY (employee_id) REFERENCES ntms.employee(employee_id);

ALTER TABLE ntms.user_account
    ADD CONSTRAINT fk_user_partner
    FOREIGN KEY (partner_id) REFERENCES ntms.business_partner(partner_id);

ALTER TABLE ntms.user_account
    ADD CONSTRAINT fk_user_dept
    FOREIGN KEY (dept_id) REFERENCES ntms.department(dept_id);

-- =====================================================================
-- 4. 차량-기사 배정 이력
--    특정 기간 동안 어떤 기사가 어떤 차량을 운행했는지 추적한다.
--    사고/과태료 귀책 판정의 근거가 된다.
-- =====================================================================
CREATE TABLE ntms.vehicle_driver (
    vehicle_driver_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    vehicle_id          BIGINT       NOT NULL REFERENCES ntms.vehicle(vehicle_id),
    driver_id           BIGINT       NOT NULL REFERENCES ntms.driver(driver_id),
    assign_role         VARCHAR(10)  NOT NULL DEFAULT 'MAIN',  -- MAIN(주)/SUB(부)
    start_date          DATE         NOT NULL,
    end_date            DATE,                               -- NULL = 현재 배정중
    assign_reason       VARCHAR(300),
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT ck_vehicle_driver_period CHECK (end_date IS NULL OR end_date >= start_date),
    CONSTRAINT ck_vehicle_driver_role CHECK (assign_role IN ('MAIN','SUB'))
);

-- 한 차량에 동시에 두 명의 주기사를 둘 수 없다
CREATE UNIQUE INDEX ux_vehicle_driver_main
    ON ntms.vehicle_driver (vehicle_id)
    WHERE assign_role = 'MAIN' AND end_date IS NULL AND is_active;

CREATE INDEX ix_vehicle_driver_driver ON ntms.vehicle_driver (tenant_id, driver_id, start_date DESC);
CREATE INDEX ix_vehicle_driver_vehicle ON ntms.vehicle_driver (tenant_id, vehicle_id, start_date DESC);

COMMENT ON TABLE ntms.vehicle_driver IS '차량-기사 배정 이력. 사고/과태료 귀책 및 실적 귀속 판정 근거';
