-- =====================================================================
-- NTMS : 05_master_item.sql
-- 품목분류 · 포장유형 · 품목(화물) 마스터
-- =====================================================================

SET search_path TO ntms, public;

-- =====================================================================
-- 1. 품목 분류 (계층형)
-- =====================================================================
CREATE TABLE ntms.item_category (
    category_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    category_code       VARCHAR(30)  NOT NULL,
    category_name       VARCHAR(200) NOT NULL,
    parent_category_id  BIGINT       REFERENCES ntms.item_category(category_id),
    category_level      SMALLINT     NOT NULL DEFAULT 1,
    sort_order          INTEGER      NOT NULL DEFAULT 0,
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_item_category UNIQUE (tenant_id, category_code)
);

COMMENT ON TABLE ntms.item_category IS '품목 분류 마스터 (계층형)';

-- =====================================================================
-- 2. 포장 유형
--    포장 단위별 표준 중량/부피를 정의해 오더 등록 시 자동 산출에 사용한다.
-- =====================================================================
CREATE TABLE ntms.packaging_type (
    packaging_type_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    packaging_code      VARCHAR(30)  NOT NULL,              -- PALLET_T11 / BOX_A / DRUM ...
    packaging_name      VARCHAR(100) NOT NULL,
    length_mm           INTEGER,
    width_mm            INTEGER,
    height_mm           INTEGER,
    tare_weight_kg      ntms.d_weight_kg,                   -- 포장재 자체 중량
    volume_cbm          ntms.d_volume_cbm,                  -- 단위 부피
    is_stackable        BOOLEAN      NOT NULL DEFAULT true, -- 적재 가능 여부
    max_stack_count     SMALLINT,                           -- 최대 단적 수
    is_returnable       BOOLEAN      NOT NULL DEFAULT false,-- 회수 대상 (파렛트 회수)
    sort_order          INTEGER      NOT NULL DEFAULT 0,
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_packaging_type UNIQUE (tenant_id, packaging_code)
);

COMMENT ON TABLE ntms.packaging_type IS '포장 유형 마스터. 적재 계획(단적/파렛트 환산)의 기준';

-- =====================================================================
-- 3. 품목 (화물)
-- =====================================================================
CREATE TABLE ntms.item (
    item_id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    item_code           VARCHAR(50)  NOT NULL,              -- 품목 코드
    item_name           VARCHAR(300) NOT NULL,
    item_name_en        VARCHAR(300),
    category_id         BIGINT       REFERENCES ntms.item_category(category_id),
    shipper_id          BIGINT       REFERENCES ntms.business_partner(partner_id),  -- 화주 전용 품목
    shipper_item_code   VARCHAR(50),                        -- 화주측 품목코드 (연계 매핑용)
    barcode             VARCHAR(50),

    -- 단위/규격
    uom_code            VARCHAR(20)  NOT NULL DEFAULT 'EA', -- 기본 단위
    unit_weight_kg      ntms.d_weight_kg,                   -- 단위당 중량
    unit_volume_cbm     ntms.d_volume_cbm,                  -- 단위당 부피
    length_mm           INTEGER,
    width_mm            INTEGER,
    height_mm           INTEGER,
    packaging_type_id   BIGINT       REFERENCES ntms.packaging_type(packaging_type_id),
    qty_per_pallet      INTEGER,                            -- 파렛트당 수량 (환산 기준)
    qty_per_box         INTEGER,

    -- 취급 조건 (배차 제약)
    is_hazardous        BOOLEAN      NOT NULL DEFAULT false,-- 위험물
    hazard_class        VARCHAR(20),                        -- 위험물 등급
    un_number           VARCHAR(10),                        -- UN 번호
    msds_file_id        BIGINT       REFERENCES ntms.file_attachment(file_id),
    temperature_zone    ntms.temperature_zone NOT NULL DEFAULT 'AMBIENT',
    temperature_min     NUMERIC(5,2),
    temperature_max     NUMERIC(5,2),
    is_fragile          BOOLEAN      NOT NULL DEFAULT false,-- 파손주의
    is_stackable        BOOLEAN      NOT NULL DEFAULT true,
    max_stack_count     SMALLINT,
    requires_upright    BOOLEAN      NOT NULL DEFAULT false,-- 정립 유지 필요
    shelf_life_days     INTEGER,                            -- 유통기한(일)

    -- 가액 (보험/손해배상 산정 기준)
    unit_price          ntms.d_unit_rate,
    currency_code       CHAR(3)      NOT NULL DEFAULT 'KRW',
    hs_code             VARCHAR(20),                        -- 수출입 품목분류

    remark              VARCHAR(1000),
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    deleted_at          TIMESTAMPTZ,
    deleted_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT ck_item_temp CHECK (
        temperature_min IS NULL OR temperature_max IS NULL OR temperature_min <= temperature_max
    )
);

CREATE UNIQUE INDEX ux_item_code ON ntms.item (tenant_id, item_code) WHERE deleted_at IS NULL;
CREATE INDEX ix_item_shipper  ON ntms.item (tenant_id, shipper_id) WHERE is_active;
CREATE INDEX ix_item_category ON ntms.item (tenant_id, category_id) WHERE is_active;
CREATE INDEX ix_item_shipper_code ON ntms.item (tenant_id, shipper_id, shipper_item_code)
    WHERE shipper_item_code IS NOT NULL;
CREATE INDEX ix_item_name_trgm ON ntms.item USING gin (item_name gin_trgm_ops);

COMMENT ON TABLE ntms.item IS '품목(화물) 마스터. 위험물/온도/적재 조건은 배차 가능 차량 판정에 사용';
