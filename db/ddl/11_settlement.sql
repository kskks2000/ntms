-- =====================================================================
-- NTMS : 11_settlement.sql
-- 정산 : 정산 헤더 · 상세 · 부대비용 · 조정 · 세금계산서 · 수금/지급 · 마감
--
-- 매출(BILLING, 화주 청구)과 매입(PAYMENT, 운송사 지급)을 동일 구조로
-- 처리한다. settlement_type 으로 구분하며 partner_id 가 청구처/지급처다.
--
-- 정산 상세에는 계산 근거(calculation_detail)를 JSONB 로 남긴다.
-- 운임표가 개정되어도 과거 정산의 산출 근거를 재현할 수 있어야 하기 때문이다.
-- =====================================================================

SET search_path TO ntms, public;

-- =====================================================================
-- 1. 정산 마감 (기간 잠금)
--    마감된 기간에는 실적 수정과 정산 생성이 금지된다.
-- =====================================================================
CREATE TABLE ntms.settlement_close (
    settlement_close_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    settlement_type     ntms.settlement_type NOT NULL,
    close_year_month    CHAR(6)      NOT NULL,              -- YYYYMM
    partner_id          BIGINT       REFERENCES ntms.business_partner(partner_id),  -- NULL = 전체 마감
    period_from         DATE         NOT NULL,
    period_to           DATE         NOT NULL,
    status              ntms.close_status NOT NULL DEFAULT 'OPEN',

    total_count         INTEGER      NOT NULL DEFAULT 0,
    total_amount        ntms.d_amount NOT NULL DEFAULT 0,

    closed_at           TIMESTAMPTZ,
    closed_by           BIGINT,
    reopened_at         TIMESTAMPTZ,
    reopened_by         BIGINT,
    reopen_reason       VARCHAR(500),
    remark              VARCHAR(500),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT ck_close_ym CHECK (close_year_month ~ '^[0-9]{6}$'),
    CONSTRAINT ck_close_period CHECK (period_to >= period_from)
);

CREATE UNIQUE INDEX ux_settlement_close ON ntms.settlement_close (
    tenant_id, settlement_type, close_year_month, COALESCE(partner_id, 0)
);

COMMENT ON TABLE ntms.settlement_close IS '정산 마감. CLOSED 기간의 실적 변경과 정산 생성은 차단된다';

-- =====================================================================
-- 2. 정산 헤더
-- =====================================================================
CREATE TABLE ntms.settlement (
    settlement_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    settlement_no       VARCHAR(30)  NOT NULL,              -- 정산번호 (fn_next_no)
    settlement_type     ntms.settlement_type NOT NULL,      -- BILLING(매출) / PAYMENT(매입)

    -- 상대처
    partner_id          BIGINT       NOT NULL REFERENCES ntms.business_partner(partner_id),
    partner_name        VARCHAR(200) NOT NULL,              -- 스냅샷
    partner_business_no ntms.d_biz_no,
    contract_id         BIGINT       REFERENCES ntms.partner_contract(contract_id),

    -- 정산 기간
    settlement_year_month CHAR(6)    NOT NULL,              -- YYYYMM
    period_from         DATE         NOT NULL,
    period_to           DATE         NOT NULL,
    closing_date        DATE,                               -- 마감일
    issue_date          DATE,                               -- 계산서 발행 예정일
    payment_due_date    DATE,                               -- 결제 예정일

    -- 금액 (상세 합계와 항상 일치해야 한다)
    detail_count        INTEGER      NOT NULL DEFAULT 0,    -- 정산 건수
    base_amount         ntms.d_amount NOT NULL DEFAULT 0,   -- 기본 운임 합계
    surcharge_amount    ntms.d_amount NOT NULL DEFAULT 0,   -- 부대비용 합계
    fuel_surcharge_amount ntms.d_amount NOT NULL DEFAULT 0, -- 유류할증 합계
    discount_amount     ntms.d_amount NOT NULL DEFAULT 0,   -- 할인
    adjustment_amount   ntms.d_amount NOT NULL DEFAULT 0,   -- 조정 (가감)
    supply_amount       ntms.d_amount NOT NULL DEFAULT 0,   -- 공급가액
    tax_amount          ntms.d_amount NOT NULL DEFAULT 0,   -- 부가세
    total_amount        ntms.d_amount NOT NULL DEFAULT 0,   -- 합계
    currency_code       CHAR(3)      NOT NULL DEFAULT 'KRW',

    -- 수납/지급
    paid_amount         ntms.d_amount NOT NULL DEFAULT 0,
    unpaid_amount       ntms.d_amount NOT NULL DEFAULT 0,
    last_paid_at        TIMESTAMPTZ,

    -- 상태 / 결재
    status              ntms.settlement_status NOT NULL DEFAULT 'DRAFT',
    calculated_at       TIMESTAMPTZ,
    confirmed_at        TIMESTAMPTZ,
    confirmed_by        BIGINT,
    approved_at         TIMESTAMPTZ,
    approved_by         BIGINT,
    reject_reason       VARCHAR(500),
    cancel_reason       VARCHAR(500),
    cancelled_at        TIMESTAMPTZ,
    cancelled_by        BIGINT,

    -- 상대처 확인 (화주/운송사 포털에서 확인)
    partner_confirmed   BOOLEAN      NOT NULL DEFAULT false,
    partner_confirmed_at TIMESTAMPTZ,
    dispute_reason      VARCHAR(1000),                      -- 이의 제기 사유

    tax_invoice_id      BIGINT,                             -- 세금계산서 (아래 정의 후 FK)
    settlement_close_id BIGINT       REFERENCES ntms.settlement_close(settlement_close_id),
    remark              VARCHAR(1000),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    deleted_at          TIMESTAMPTZ,
    deleted_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_settlement_no UNIQUE (tenant_id, settlement_no),
    CONSTRAINT ck_settlement_ym CHECK (settlement_year_month ~ '^[0-9]{6}$'),
    CONSTRAINT ck_settlement_period CHECK (period_to >= period_from),
    CONSTRAINT ck_settlement_amount CHECK (total_amount = supply_amount + tax_amount),
    CONSTRAINT ck_settlement_paid CHECK (paid_amount >= 0 AND paid_amount <= total_amount + 0.01)
);

CREATE INDEX ix_settlement_partner ON ntms.settlement (tenant_id, partner_id, settlement_year_month DESC);
CREATE INDEX ix_settlement_period  ON ntms.settlement (tenant_id, settlement_type, period_from, period_to);
CREATE INDEX ix_settlement_status  ON ntms.settlement (tenant_id, status, settlement_year_month DESC);
CREATE INDEX ix_settlement_unpaid  ON ntms.settlement (tenant_id, payment_due_date)
    WHERE status IN ('INVOICED','PARTIALLY_PAID') AND deleted_at IS NULL;

COMMENT ON TABLE ntms.settlement IS '정산 헤더. 매출/매입을 동일 구조로 관리하며 금액은 상세 합계와 일치해야 한다';

-- =====================================================================
-- 3. 정산 상세 (실적 건별)
-- =====================================================================
CREATE TABLE ntms.settlement_detail (
    settlement_detail_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    settlement_id       BIGINT       NOT NULL REFERENCES ntms.settlement(settlement_id) ON DELETE CASCADE,
    line_no             INTEGER      NOT NULL,

    -- 정산 대상 (실적 → 정산 추적)
    actual_id           BIGINT       REFERENCES ntms.transport_actual(actual_id),
    actual_order_id     BIGINT       REFERENCES ntms.actual_order(actual_order_id),
    order_id            BIGINT       REFERENCES ntms.transport_order(order_id),
    dispatch_id         BIGINT       REFERENCES ntms.dispatch(dispatch_id),
    trip_id             BIGINT       REFERENCES ntms.trip(trip_id),

    -- 명세 표기 (스냅샷 — 마스터가 바뀌어도 명세서가 변하면 안 된다)
    transport_date      DATE         NOT NULL,
    order_no            VARCHAR(30),
    from_location_name  VARCHAR(200),
    to_location_name    VARCHAR(200),
    vehicle_no          VARCHAR(20),
    vehicle_type_name   VARCHAR(100),
    driver_name         VARCHAR(100),
    item_summary        VARCHAR(300),                       -- 품목 요약

    -- 산출 기준값
    distance_km         ntms.d_distance,
    weight_kg           ntms.d_weight_kg,
    volume_cbm          ntms.d_volume_cbm,
    qty                 NUMERIC(14,3),
    pallet_qty          NUMERIC(10,2),
    stop_count          SMALLINT,
    waiting_minutes     INTEGER,

    -- 적용 운임
    rate_table_id       BIGINT       REFERENCES ntms.rate_table(rate_table_id),
    rate_detail_id      BIGINT       REFERENCES ntms.rate_table_detail(rate_detail_id),
    rate_method         ntms.rate_method,
    unit_rate           ntms.d_unit_rate,

    -- 금액
    base_amount         ntms.d_amount NOT NULL DEFAULT 0,
    surcharge_amount    ntms.d_amount NOT NULL DEFAULT 0,
    fuel_surcharge_amount ntms.d_amount NOT NULL DEFAULT 0,
    discount_amount     ntms.d_amount NOT NULL DEFAULT 0,
    adjustment_amount   ntms.d_amount NOT NULL DEFAULT 0,
    supply_amount       ntms.d_amount NOT NULL DEFAULT 0,
    tax_amount          ntms.d_amount NOT NULL DEFAULT 0,
    total_amount        ntms.d_amount NOT NULL DEFAULT 0,
    is_taxable          BOOLEAN      NOT NULL DEFAULT true,

    -- 산출 근거 (재현 가능성 확보)
    calculation_detail  JSONB,                              -- 적용 규칙/구간/중간값 전체
    calculation_note    VARCHAR(500),
    is_manual           BOOLEAN      NOT NULL DEFAULT false,-- 수기 입력 여부
    manual_reason       VARCHAR(500),

    remark              VARCHAR(500),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_settlement_detail_line UNIQUE (settlement_id, line_no),
    CONSTRAINT ck_settlement_detail_amount CHECK (total_amount = supply_amount + tax_amount)
);

CREATE INDEX ix_settlement_detail_settlement ON ntms.settlement_detail (settlement_id, line_no);
CREATE INDEX ix_settlement_detail_actual     ON ntms.settlement_detail (tenant_id, actual_id);
CREATE INDEX ix_settlement_detail_order      ON ntms.settlement_detail (tenant_id, order_id);
CREATE INDEX ix_settlement_detail_date       ON ntms.settlement_detail (tenant_id, transport_date);
CREATE INDEX ix_settlement_detail_calc       ON ntms.settlement_detail USING gin (calculation_detail);

COMMENT ON TABLE ntms.settlement_detail IS '정산 상세. calculation_detail 에 산출 근거를 남겨 과거 정산을 재현 가능하게 한다';

-- =====================================================================
-- 4. 부대비용 라인
-- =====================================================================
CREATE TABLE ntms.settlement_charge (
    settlement_charge_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    settlement_id       BIGINT       NOT NULL REFERENCES ntms.settlement(settlement_id) ON DELETE CASCADE,
    settlement_detail_id BIGINT      REFERENCES ntms.settlement_detail(settlement_detail_id) ON DELETE CASCADE,
    surcharge_type_id   BIGINT       REFERENCES ntms.surcharge_type(surcharge_type_id),
    charge_code         VARCHAR(30)  NOT NULL,              -- 스냅샷
    charge_name         VARCHAR(100) NOT NULL,              -- 스냅샷

    charge_method       ntms.charge_method NOT NULL,
    base_value          NUMERIC(14,3),                      -- 산출 기준값 (대기 90분 등)
    base_unit           VARCHAR(20),                        -- 기준 단위 (MIN/EA/KM)
    unit_rate           ntms.d_unit_rate,
    qty                 NUMERIC(14,3) NOT NULL DEFAULT 1,
    rate_pct            ntms.d_rate_pct,
    amount              ntms.d_amount NOT NULL DEFAULT 0,
    is_taxable          BOOLEAN      NOT NULL DEFAULT true,

    -- 증빙 / 승인 (부대비는 분쟁이 잦아 별도 통제)
    evidence_file_id    BIGINT       REFERENCES ntms.file_attachment(file_id),
    exception_id        BIGINT       REFERENCES ntms.transport_exception(exception_id),
    approval_status     ntms.approval_status NOT NULL DEFAULT 'DRAFT',
    requested_by        BIGINT,
    requested_at        TIMESTAMPTZ,
    approved_by         BIGINT,
    approved_at         TIMESTAMPTZ,
    reject_reason       VARCHAR(500),

    is_auto_calculated  BOOLEAN      NOT NULL DEFAULT false,
    remark              VARCHAR(500),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0
);

CREATE INDEX ix_settlement_charge_settlement ON ntms.settlement_charge (settlement_id);
CREATE INDEX ix_settlement_charge_detail     ON ntms.settlement_charge (settlement_detail_id);
CREATE INDEX ix_settlement_charge_pending    ON ntms.settlement_charge (tenant_id, approval_status)
    WHERE approval_status IN ('DRAFT','REQUESTED');

COMMENT ON TABLE ntms.settlement_charge IS '정산 부대비용 (대기료/경유료/하역비 등). 증빙과 승인을 별도 관리';

-- =====================================================================
-- 5. 정산 조정
--    확정된 정산의 금액을 바꿀 때는 원본을 수정하지 않고 조정 라인을 추가한다.
-- =====================================================================
CREATE TABLE ntms.settlement_adjustment (
    settlement_adjustment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    settlement_id       BIGINT       NOT NULL REFERENCES ntms.settlement(settlement_id) ON DELETE CASCADE,
    settlement_detail_id BIGINT      REFERENCES ntms.settlement_detail(settlement_detail_id),
    adjustment_no       VARCHAR(30),
    adjustment_type     ntms.adjustment_type NOT NULL,
    reason_code         VARCHAR(30),
    reason              VARCHAR(1000) NOT NULL,

    supply_amount       ntms.d_amount NOT NULL DEFAULT 0,   -- 음수 = 차감
    tax_amount          ntms.d_amount NOT NULL DEFAULT 0,
    total_amount        ntms.d_amount NOT NULL DEFAULT 0,

    -- 근거 연결
    exception_id        BIGINT       REFERENCES ntms.transport_exception(exception_id),
    evidence_file_id    BIGINT       REFERENCES ntms.file_attachment(file_id),

    -- 결재
    status              ntms.approval_status NOT NULL DEFAULT 'DRAFT',
    requested_by        BIGINT,
    requested_at        TIMESTAMPTZ,
    approved_by         BIGINT,
    approved_at         TIMESTAMPTZ,
    reject_reason       VARCHAR(500),
    applied_at          TIMESTAMPTZ,                        -- 정산 반영 시각
    remark              VARCHAR(500),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT ck_adjustment_amount CHECK (total_amount = supply_amount + tax_amount)
);

CREATE INDEX ix_adjustment_settlement ON ntms.settlement_adjustment (settlement_id);
CREATE INDEX ix_adjustment_pending    ON ntms.settlement_adjustment (tenant_id, status)
    WHERE status IN ('DRAFT','REQUESTED');

COMMENT ON TABLE ntms.settlement_adjustment IS '정산 조정. 확정 정산은 수정 대신 조정 라인 추가로만 변경한다';

-- =====================================================================
-- 6. 세금계산서
-- =====================================================================
CREATE TABLE ntms.tax_invoice (
    tax_invoice_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    settlement_id       BIGINT       REFERENCES ntms.settlement(settlement_id),
    invoice_type        ntms.tax_invoice_type NOT NULL DEFAULT 'TAX',
    invoice_no          VARCHAR(30),                        -- 내부 관리번호
    nts_approval_no     VARCHAR(50),                        -- 국세청 승인번호
    issue_date          DATE         NOT NULL,
    write_date          DATE,                               -- 작성일자

    -- 공급자
    supplier_business_no ntms.d_biz_no NOT NULL,
    supplier_name       VARCHAR(200) NOT NULL,
    supplier_ceo_name   VARCHAR(100),
    supplier_address    VARCHAR(500),
    supplier_biz_type   VARCHAR(100),
    supplier_biz_item   VARCHAR(100),
    supplier_email      VARCHAR(200),

    -- 공급받는자
    buyer_business_no   ntms.d_biz_no NOT NULL,
    buyer_name          VARCHAR(200) NOT NULL,
    buyer_ceo_name      VARCHAR(100),
    buyer_address       VARCHAR(500),
    buyer_biz_type      VARCHAR(100),
    buyer_biz_item      VARCHAR(100),
    buyer_email         VARCHAR(200),

    -- 금액
    supply_amount       ntms.d_amount NOT NULL,
    tax_amount          ntms.d_amount NOT NULL,
    total_amount        ntms.d_amount NOT NULL,
    currency_code       CHAR(3)      NOT NULL DEFAULT 'KRW',
    remark_text         VARCHAR(500),

    -- 국세청 전송
    status              ntms.tax_invoice_status NOT NULL DEFAULT 'DRAFT',
    nts_sent_at         TIMESTAMPTZ,
    nts_result_code     VARCHAR(20),
    nts_result_message  VARCHAR(500),
    provider_name       VARCHAR(50),                        -- 발행 대행사
    provider_doc_id     VARCHAR(100),

    -- 수정 세금계산서
    original_tax_invoice_id BIGINT   REFERENCES ntms.tax_invoice(tax_invoice_id),
    modify_reason_code  VARCHAR(20),                        -- 국세청 수정사유 코드
    modify_reason       VARCHAR(500),

    file_id             BIGINT       REFERENCES ntms.file_attachment(file_id),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT ck_tax_invoice_amount CHECK (total_amount = supply_amount + tax_amount)
);

CREATE UNIQUE INDEX ux_tax_invoice_nts ON ntms.tax_invoice (nts_approval_no)
    WHERE nts_approval_no IS NOT NULL;
CREATE INDEX ix_tax_invoice_settlement ON ntms.tax_invoice (settlement_id);
CREATE INDEX ix_tax_invoice_issue      ON ntms.tax_invoice (tenant_id, issue_date DESC);
CREATE INDEX ix_tax_invoice_status     ON ntms.tax_invoice (tenant_id, status)
    WHERE status IN ('DRAFT','ISSUED','REJECTED');

COMMENT ON TABLE ntms.tax_invoice IS '세금계산서. 국세청 전송 결과와 수정계산서 원본 참조를 관리';

ALTER TABLE ntms.settlement
    ADD CONSTRAINT fk_settlement_tax_invoice
    FOREIGN KEY (tax_invoice_id) REFERENCES ntms.tax_invoice(tax_invoice_id);

-- =====================================================================
-- 7. 수금 / 지급 이력
-- =====================================================================
CREATE TABLE ntms.payment_record (
    payment_record_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    settlement_id       BIGINT       NOT NULL REFERENCES ntms.settlement(settlement_id),
    partner_id          BIGINT       NOT NULL REFERENCES ntms.business_partner(partner_id),
    payment_direction   ntms.payment_direction NOT NULL,    -- RECEIPT(수금) / DISBURSEMENT(지급)
    payment_method      ntms.payment_method NOT NULL DEFAULT 'BANK_TRANSFER',
    payment_date        DATE         NOT NULL,
    payment_amount      ntms.d_amount NOT NULL,
    currency_code       CHAR(3)      NOT NULL DEFAULT 'KRW',

    bank_code           VARCHAR(10),
    bank_name           VARCHAR(50),
    account_no          VARCHAR(50),
    account_holder      VARCHAR(100),
    transaction_no      VARCHAR(100),                       -- 은행 거래번호
    depositor_name      VARCHAR(100),                       -- 입금자명 (수금 대사)

    -- 상계 처리
    offset_settlement_id BIGINT      REFERENCES ntms.settlement(settlement_id),
    is_matched          BOOLEAN      NOT NULL DEFAULT false,-- 대사 완료 여부
    matched_at          TIMESTAMPTZ,
    matched_by          BIGINT,

    evidence_file_id    BIGINT       REFERENCES ntms.file_attachment(file_id),
    remark              VARCHAR(500),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT ck_payment_amount CHECK (payment_amount <> 0)
);

CREATE INDEX ix_payment_settlement ON ntms.payment_record (settlement_id, payment_date);
CREATE INDEX ix_payment_partner    ON ntms.payment_record (tenant_id, partner_id, payment_date DESC);
CREATE INDEX ix_payment_unmatched  ON ntms.payment_record (tenant_id, payment_date DESC)
    WHERE is_matched = false;

COMMENT ON TABLE ntms.payment_record IS '수금/지급 이력. 은행 거래내역과의 대사(matching) 상태를 관리';

-- =====================================================================
-- 8. 실적 → 정산 역참조 FK
-- =====================================================================
ALTER TABLE ntms.transport_actual
    ADD CONSTRAINT fk_actual_billing_settlement
    FOREIGN KEY (billing_settlement_id) REFERENCES ntms.settlement(settlement_id);

ALTER TABLE ntms.transport_actual
    ADD CONSTRAINT fk_actual_payment_settlement
    FOREIGN KEY (payment_settlement_id) REFERENCES ntms.settlement(settlement_id);
