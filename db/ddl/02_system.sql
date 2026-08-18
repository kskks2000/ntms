-- =====================================================================
-- NTMS : 02_system.sql
-- 테넌트 · 공통코드 · 채번 · 사용자/인증/권한 · 감사 · 연계 · 배치
-- =====================================================================

SET search_path TO ntms, public;

-- =====================================================================
-- 1. 테넌트
-- =====================================================================
CREATE TABLE ntms.tenant (
    tenant_id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_code         VARCHAR(20)  NOT NULL,              -- 테넌트 코드 (로그인 시 식별)
    tenant_uuid         UUID         NOT NULL DEFAULT gen_random_uuid(),  -- 외부 노출용 식별자
    tenant_name         VARCHAR(200) NOT NULL,              -- 테넌트(법인)명
    tenant_name_en      VARCHAR(200),                       -- 영문명
    business_no         ntms.d_biz_no,                      -- 사업자등록번호
    corp_no             ntms.d_corp_no,                     -- 법인등록번호
    ceo_name            VARCHAR(100),                       -- 대표자명
    biz_type            VARCHAR(100),                       -- 업태
    biz_item            VARCHAR(100),                       -- 종목
    zip_code            VARCHAR(10),
    address1            VARCHAR(300),                       -- 기본주소
    address2            VARCHAR(300),                       -- 상세주소
    tel                 VARCHAR(30),
    fax                 VARCHAR(30),
    email               VARCHAR(200),
    homepage            VARCHAR(300),
    logo_file_id        BIGINT,                             -- 로고 (file_attachment)

    -- 계약/한도
    plan_code           VARCHAR(30),                        -- 요금제
    contract_start_date DATE,
    contract_end_date   DATE,
    max_user_count      INTEGER,                            -- 사용자 수 한도
    max_vehicle_count   INTEGER,                            -- 차량 수 한도

    -- 지역화
    timezone            VARCHAR(50)  NOT NULL DEFAULT 'Asia/Seoul',
    locale              VARCHAR(10)  NOT NULL DEFAULT 'ko-KR',
    currency_code       CHAR(3)      NOT NULL DEFAULT 'KRW',
    tax_rate            ntms.d_rate_pct NOT NULL DEFAULT 10.0000,  -- 기본 부가세율(%)

    status              ntms.tenant_status NOT NULL DEFAULT 'ACTIVE',
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    deleted_at          TIMESTAMPTZ,
    deleted_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT ck_tenant_code_upper CHECK (tenant_code = upper(tenant_code)),
    CONSTRAINT ck_tenant_contract CHECK (contract_end_date IS NULL OR contract_end_date >= contract_start_date)
);

CREATE UNIQUE INDEX ux_tenant_code ON ntms.tenant (tenant_code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_tenant_uuid ON ntms.tenant (tenant_uuid);

COMMENT ON TABLE ntms.tenant IS '테넌트(고객 법인) 마스터. 모든 업무 데이터의 격리 단위';

-- ---------------------------------------------------------------------
-- 테넌트 환경설정 (Key-Value)
-- ---------------------------------------------------------------------
CREATE TABLE ntms.tenant_config (
    tenant_config_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    config_key          VARCHAR(100) NOT NULL,              -- 설정 키 (예: PLAN.AUTO_CONSOLIDATE)
    config_value        TEXT,                               -- 설정 값
    value_type          VARCHAR(20)  NOT NULL DEFAULT 'STRING',  -- STRING/NUMBER/BOOLEAN/JSON
    description         VARCHAR(500),
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_tenant_config UNIQUE (tenant_id, config_key)
);

COMMENT ON TABLE ntms.tenant_config IS '테넌트별 시스템 환경설정 (Key-Value)';

-- =====================================================================
-- 2. 공통코드
--    tenant_id IS NULL  → 전 테넌트 공용(시스템 코드)
--    tenant_id NOT NULL → 해당 테넌트 전용 코드
-- =====================================================================
CREATE TABLE ntms.code_group (
    code_group_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       REFERENCES ntms.tenant(tenant_id),
    group_code          VARCHAR(50)  NOT NULL,              -- 그룹코드 (예: CARGO_TYPE)
    group_name          VARCHAR(200) NOT NULL,
    description         VARCHAR(500),
    is_system           BOOLEAN      NOT NULL DEFAULT false,-- 시스템 코드 여부(수정 불가)
    sort_order          INTEGER      NOT NULL DEFAULT 0,
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX ux_code_group ON ntms.code_group (COALESCE(tenant_id, 0), group_code);

COMMENT ON TABLE ntms.code_group IS '공통코드 그룹. tenant_id NULL 은 전 테넌트 공용';

CREATE TABLE ntms.code (
    code_id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code_group_id       BIGINT       NOT NULL REFERENCES ntms.code_group(code_group_id) ON DELETE CASCADE,
    tenant_id           BIGINT       REFERENCES ntms.tenant(tenant_id),
    code_value          VARCHAR(50)  NOT NULL,              -- 코드값
    code_name           VARCHAR(200) NOT NULL,              -- 코드명
    code_name_en        VARCHAR(200),
    parent_code_id      BIGINT       REFERENCES ntms.code(code_id),  -- 계층형 코드
    sort_order          INTEGER      NOT NULL DEFAULT 0,
    attr1               VARCHAR(200),                       -- 확장속성 1
    attr2               VARCHAR(200),
    attr3               VARCHAR(200),
    attr_json           JSONB,                              -- 구조화 확장속성
    description         VARCHAR(500),
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_code UNIQUE (code_group_id, code_value)
);

CREATE INDEX ix_code_group_active ON ntms.code (code_group_id, is_active, sort_order);

COMMENT ON TABLE ntms.code IS '공통코드 상세';

-- =====================================================================
-- 3. 채번 규칙
-- =====================================================================
CREATE TABLE ntms.numbering_rule (
    numbering_rule_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    rule_code           VARCHAR(30)  NOT NULL,              -- ORDER / TRIP / DISPATCH / SETTLEMENT ...
    rule_name           VARCHAR(100) NOT NULL,
    prefix              VARCHAR(20),                        -- 접두어 (예: 'TO')
    date_format         VARCHAR(20),                        -- to_char 포맷 (예: 'YYYYMMDD')
    seq_length          INTEGER      NOT NULL DEFAULT 5,    -- 시퀀스 자릿수 (0 패딩)
    reset_cycle         VARCHAR(10)  NOT NULL DEFAULT 'DAILY',  -- DAILY/MONTHLY/YEARLY/NONE
    current_seq         BIGINT       NOT NULL DEFAULT 0,    -- 현재 시퀀스
    last_reset_date     DATE,                               -- 최종 리셋 일자
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_numbering_rule UNIQUE (tenant_id, rule_code),
    CONSTRAINT ck_numbering_reset CHECK (reset_cycle IN ('DAILY','MONTHLY','YEARLY','NONE')),
    CONSTRAINT ck_numbering_seq_len CHECK (seq_length BETWEEN 1 AND 12)
);

COMMENT ON TABLE ntms.numbering_rule IS '업무번호 채번 규칙. ntms.fn_next_no() 가 참조';

-- =====================================================================
-- 4. 사용자 / 인증
-- =====================================================================
CREATE TABLE ntms.user_account (
    user_id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    user_uuid           UUID         NOT NULL DEFAULT gen_random_uuid(),  -- 토큰/외부노출 식별자
    login_id            VARCHAR(100) NOT NULL,              -- 로그인 ID
    password_hash       VARCHAR(255),                       -- 비밀번호 해시 (argon2id/bcrypt)
    password_algo       VARCHAR(20)  NOT NULL DEFAULT 'argon2id',
    password_changed_at TIMESTAMPTZ,                        -- 최종 변경일시
    password_expire_at  TIMESTAMPTZ,                        -- 만료 예정일시 (90일 정책 등)
    must_change_password BOOLEAN     NOT NULL DEFAULT false,-- 최초 로그인 강제 변경

    user_name           VARCHAR(100) NOT NULL,
    user_name_en        VARCHAR(100),
    email               VARCHAR(200),
    mobile              VARCHAR(30),
    tel                 VARCHAR(30),

    user_type           ntms.user_type   NOT NULL DEFAULT 'INTERNAL',
    employee_id         BIGINT,                             -- 내부 사원 연결 (03_master_org)
    partner_id          BIGINT,                             -- 화주/운송사 담당자 연결
    driver_id           BIGINT,                             -- 기사앱 계정 연결 (04_master_fleet)
    dept_id             BIGINT,                             -- 소속 부서

    status              ntms.user_status NOT NULL DEFAULT 'ACTIVE',
    login_fail_count    SMALLINT     NOT NULL DEFAULT 0,    -- 연속 실패 횟수
    last_login_at       TIMESTAMPTZ,
    last_login_ip       INET,
    locked_at           TIMESTAMPTZ,                        -- 잠김 시각
    dormant_at          TIMESTAMPTZ,                        -- 휴면 전환 시각
    withdrawn_at        TIMESTAMPTZ,

    mfa_enabled         BOOLEAN      NOT NULL DEFAULT false,
    mfa_secret          VARCHAR(255),                       -- TOTP 시크릿 (암호화 저장)

    agree_terms_at      TIMESTAMPTZ,                        -- 이용약관 동의
    agree_privacy_at    TIMESTAMPTZ,                        -- 개인정보 처리 동의
    agree_marketing_at  TIMESTAMPTZ,

    default_menu_id     BIGINT,                             -- 로그인 후 진입 메뉴
    profile_file_id     BIGINT,
    remark              VARCHAR(500),
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    deleted_at          TIMESTAMPTZ,
    deleted_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX ux_user_login ON ntms.user_account (tenant_id, login_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_user_uuid  ON ntms.user_account (user_uuid);
CREATE INDEX ix_user_tenant_status ON ntms.user_account (tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX ix_user_driver ON ntms.user_account (driver_id) WHERE driver_id IS NOT NULL;

COMMENT ON TABLE ntms.user_account IS '사용자 계정. 내부 임직원/화주/운송사/기사 계정을 통합 관리';

-- ---------------------------------------------------------------------
-- 교차 테넌트 접근 권한 (그룹사 통합 관제 등)
-- ---------------------------------------------------------------------
CREATE TABLE ntms.user_tenant_access (
    user_tenant_access_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id             BIGINT       NOT NULL REFERENCES ntms.user_account(user_id) ON DELETE CASCADE,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    access_type         VARCHAR(20)  NOT NULL DEFAULT 'READ',  -- READ / FULL
    valid_from          DATE,
    valid_to            DATE,
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_user_tenant_access UNIQUE (user_id, tenant_id)
);

COMMENT ON TABLE ntms.user_tenant_access IS '사용자의 타 테넌트 접근 허용 목록(그룹사 통합 조회용)';

-- =====================================================================
-- 5. 권한 (Role / Permission / Menu)
-- =====================================================================
CREATE TABLE ntms.role (
    role_id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       REFERENCES ntms.tenant(tenant_id),  -- NULL = 시스템 공용 역할
    role_code           VARCHAR(50)  NOT NULL,              -- ADMIN / DISPATCHER / SHIPPER_USER ...
    role_name           VARCHAR(100) NOT NULL,
    description         VARCHAR(500),
    is_system           BOOLEAN      NOT NULL DEFAULT false,
    sort_order          INTEGER      NOT NULL DEFAULT 0,
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX ux_role_code ON ntms.role (COALESCE(tenant_id, 0), role_code);

COMMENT ON TABLE ntms.role IS '역할(Role) 마스터';

CREATE TABLE ntms.permission (
    permission_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    permission_code     VARCHAR(100) NOT NULL UNIQUE,       -- ORDER.CREATE / DISPATCH.APPROVE ...
    permission_name     VARCHAR(200) NOT NULL,
    module_code         VARCHAR(50)  NOT NULL,              -- ORDER/PLAN/EXECUTION/SETTLEMENT ...
    resource_type       VARCHAR(50)  NOT NULL,              -- 대상 리소스
    action_type         VARCHAR(20)  NOT NULL,              -- CREATE/READ/UPDATE/DELETE/APPROVE/EXPORT
    description         VARCHAR(500),
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE ntms.permission IS '기능 권한 마스터 (시스템 전역 정의)';

CREATE TABLE ntms.role_permission (
    role_id             BIGINT       NOT NULL REFERENCES ntms.role(role_id) ON DELETE CASCADE,
    permission_id       BIGINT       NOT NULL REFERENCES ntms.permission(permission_id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    PRIMARY KEY (role_id, permission_id)
);

COMMENT ON TABLE ntms.role_permission IS '역할-권한 매핑';

CREATE TABLE ntms.user_role (
    user_id             BIGINT       NOT NULL REFERENCES ntms.user_account(user_id) ON DELETE CASCADE,
    role_id             BIGINT       NOT NULL REFERENCES ntms.role(role_id) ON DELETE CASCADE,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    valid_from          DATE,
    valid_to            DATE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    PRIMARY KEY (user_id, role_id)
);

CREATE INDEX ix_user_role_tenant ON ntms.user_role (tenant_id, role_id);

COMMENT ON TABLE ntms.user_role IS '사용자-역할 매핑';

CREATE TABLE ntms.menu (
    menu_id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       REFERENCES ntms.tenant(tenant_id),  -- NULL = 표준 메뉴
    parent_menu_id      BIGINT       REFERENCES ntms.menu(menu_id),
    menu_code           VARCHAR(50)  NOT NULL,
    menu_name           VARCHAR(100) NOT NULL,
    menu_name_en        VARCHAR(100),
    menu_path           VARCHAR(300),                       -- 프론트 라우트 경로
    icon_name           VARCHAR(50),
    menu_level          SMALLINT     NOT NULL DEFAULT 1,
    sort_order          INTEGER      NOT NULL DEFAULT 0,
    is_display          BOOLEAN      NOT NULL DEFAULT true, -- 메뉴 노출 여부
    is_leaf             BOOLEAN      NOT NULL DEFAULT true,
    program_id          VARCHAR(50),                        -- 화면 프로그램 ID (감사 추적용)
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX ux_menu_code ON ntms.menu (COALESCE(tenant_id, 0), menu_code);
CREATE INDEX ix_menu_parent ON ntms.menu (parent_menu_id, sort_order);

COMMENT ON TABLE ntms.menu IS '메뉴 마스터 (계층형)';

CREATE TABLE ntms.role_menu (
    role_id             BIGINT       NOT NULL REFERENCES ntms.role(role_id) ON DELETE CASCADE,
    menu_id             BIGINT       NOT NULL REFERENCES ntms.menu(menu_id) ON DELETE CASCADE,
    can_read            BOOLEAN      NOT NULL DEFAULT true,
    can_create          BOOLEAN      NOT NULL DEFAULT false,
    can_update          BOOLEAN      NOT NULL DEFAULT false,
    can_delete          BOOLEAN      NOT NULL DEFAULT false,
    can_approve         BOOLEAN      NOT NULL DEFAULT false,
    can_export          BOOLEAN      NOT NULL DEFAULT false,  -- 엑셀 다운로드 (개인정보 통제)
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    PRIMARY KEY (role_id, menu_id)
);

COMMENT ON TABLE ntms.role_menu IS '역할-메뉴 접근권한 (CRUD/승인/다운로드 단위)';

-- =====================================================================
-- 6. 세션 / 로그인 이력
-- =====================================================================
CREATE TABLE ntms.user_session (
    user_session_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    user_id             BIGINT       NOT NULL REFERENCES ntms.user_account(user_id) ON DELETE CASCADE,
    token_hash          VARCHAR(255) NOT NULL,              -- refresh token 해시 (평문 저장 금지)
    device_type         VARCHAR(20),                        -- WEB/MOBILE/APP
    device_id           VARCHAR(200),
    user_agent          VARCHAR(500),
    ip_address          INET,
    issued_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at          TIMESTAMPTZ  NOT NULL,
    last_used_at        TIMESTAMPTZ,
    revoked_at          TIMESTAMPTZ,                        -- 강제 로그아웃 시각
    revoke_reason       VARCHAR(100),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ux_user_session_token ON ntms.user_session (token_hash);
CREATE INDEX ix_user_session_user ON ntms.user_session (user_id, revoked_at, expires_at);

COMMENT ON TABLE ntms.user_session IS '리프레시 토큰 세션. 만료/폐기 토큰은 배치로 정리';

CREATE TABLE ntms.login_history (
    login_history_id    BIGINT GENERATED ALWAYS AS IDENTITY,
    tenant_id           BIGINT,
    user_id             BIGINT,
    login_id            VARCHAR(100) NOT NULL,              -- 실패 시 계정이 없을 수 있어 문자열 보존
    login_type          VARCHAR(20)  NOT NULL DEFAULT 'PASSWORD',  -- PASSWORD/SSO/MFA/TOKEN
    login_result        ntms.login_result NOT NULL,
    fail_reason         VARCHAR(200),
    ip_address          INET,
    user_agent          VARCHAR(500),
    device_type         VARCHAR(20),
    login_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (login_history_id, login_at)
) PARTITION BY RANGE (login_at);

CREATE INDEX ix_login_history_user ON ntms.login_history (user_id, login_at DESC);
CREATE INDEX ix_login_history_tenant ON ntms.login_history (tenant_id, login_at DESC);

COMMENT ON TABLE ntms.login_history IS '로그인 시도 이력 (월 단위 파티션). 보안감사 대상';

-- =====================================================================
-- 7. 변경 감사 로그
-- =====================================================================
CREATE TABLE ntms.audit_log (
    audit_log_id        BIGINT GENERATED ALWAYS AS IDENTITY,
    tenant_id           BIGINT,
    table_name          VARCHAR(100) NOT NULL,              -- 대상 테이블
    record_pk           VARCHAR(100),                       -- 대상 레코드 PK
    action              ntms.audit_action NOT NULL,
    before_data         JSONB,                              -- 변경 전 스냅샷
    after_data          JSONB,                              -- 변경 후 스냅샷
    changed_by          BIGINT,                             -- 변경자 user_id
    changed_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    client_ip           INET,
    program_id          VARCHAR(50),                        -- 화면/배치 식별자
    PRIMARY KEY (audit_log_id, changed_at)
) PARTITION BY RANGE (changed_at);

CREATE INDEX ix_audit_log_table  ON ntms.audit_log (table_name, record_pk, changed_at DESC);
CREATE INDEX ix_audit_log_tenant ON ntms.audit_log (tenant_id, changed_at DESC);
CREATE INDEX ix_audit_log_user   ON ntms.audit_log (changed_by, changed_at DESC);

COMMENT ON TABLE ntms.audit_log IS '데이터 변경 감사 로그 (월 단위 파티션). 정산 분쟁 및 보안감사 근거';

-- =====================================================================
-- 8. 첨부파일
-- =====================================================================
CREATE TABLE ntms.file_attachment (
    file_id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    ref_type            VARCHAR(50)  NOT NULL,              -- ORDER/POD/EXCEPTION/CONTRACT/SETTLEMENT ...
    ref_id              BIGINT,                             -- 참조 레코드 ID
    file_name           VARCHAR(300) NOT NULL,              -- 원본 파일명
    stored_name         VARCHAR(300) NOT NULL,              -- 저장 파일명(UUID)
    file_path           VARCHAR(500) NOT NULL,              -- 저장 경로 / 오브젝트 키
    file_ext            VARCHAR(20),
    file_size           BIGINT       NOT NULL,              -- 바이트
    mime_type           VARCHAR(100),
    storage_type        VARCHAR(20)  NOT NULL DEFAULT 'LOCAL',  -- LOCAL/S3/NCP_OBJECT
    checksum            VARCHAR(100),                       -- SHA-256 (무결성 검증)
    is_public           BOOLEAN      NOT NULL DEFAULT false,
    download_count      INTEGER      NOT NULL DEFAULT 0,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    deleted_at          TIMESTAMPTZ,
    deleted_by          BIGINT
);

CREATE INDEX ix_file_ref ON ntms.file_attachment (tenant_id, ref_type, ref_id) WHERE deleted_at IS NULL;

COMMENT ON TABLE ntms.file_attachment IS '첨부파일 메타. 실제 바이너리는 오브젝트 스토리지에 보관';

-- =====================================================================
-- 9. 알림
-- =====================================================================
CREATE TABLE ntms.notification_template (
    template_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    template_code       VARCHAR(50)  NOT NULL,              -- DISPATCH_ASSIGNED / DELIVERY_DONE ...
    template_name       VARCHAR(200) NOT NULL,
    channel             ntms.notify_channel NOT NULL,
    subject             VARCHAR(300),
    body                TEXT         NOT NULL,              -- {{변수}} 치환 템플릿
    variables           JSONB,                              -- 사용 가능 변수 정의
    external_template_id VARCHAR(100),                      -- 알림톡 템플릿 코드
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_notification_template UNIQUE (tenant_id, template_code, channel)
);

COMMENT ON TABLE ntms.notification_template IS '알림 템플릿 (SMS/알림톡/이메일/푸시)';

CREATE TABLE ntms.notification (
    notification_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    template_id         BIGINT       REFERENCES ntms.notification_template(template_id),
    channel             ntms.notify_channel NOT NULL,
    recipient_user_id   BIGINT       REFERENCES ntms.user_account(user_id),
    recipient_address   VARCHAR(300) NOT NULL,              -- 수신 번호/이메일/토큰
    recipient_name      VARCHAR(100),
    subject             VARCHAR(300),
    body                TEXT         NOT NULL,              -- 치환 완료 본문
    ref_type            VARCHAR(50),                        -- 연관 업무 유형
    ref_id              BIGINT,                             -- 연관 업무 ID
    status              ntms.notify_status NOT NULL DEFAULT 'PENDING',
    scheduled_at        TIMESTAMPTZ,                        -- 예약 발송 시각
    sent_at             TIMESTAMPTZ,
    read_at             TIMESTAMPTZ,
    fail_reason         VARCHAR(500),
    retry_count         SMALLINT     NOT NULL DEFAULT 0,
    external_message_id VARCHAR(100),                       -- 발송사 메시지 ID

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT
);

CREATE INDEX ix_notification_status ON ntms.notification (status, scheduled_at) WHERE status IN ('PENDING','FAILED');
CREATE INDEX ix_notification_user   ON ntms.notification (recipient_user_id, created_at DESC);
CREATE INDEX ix_notification_ref    ON ntms.notification (tenant_id, ref_type, ref_id);

COMMENT ON TABLE ntms.notification IS '알림 발송 내역';

-- =====================================================================
-- 10. 외부 연계 (통합 연계 대상 시스템 I/F 로그)
-- =====================================================================
CREATE TABLE ntms.interface_master (
    interface_master_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL REFERENCES ntms.tenant(tenant_id),
    interface_code      VARCHAR(50)  NOT NULL,              -- IF_ORDER_IN / IF_STATUS_OUT ...
    interface_name      VARCHAR(200) NOT NULL,
    partner_system      VARCHAR(100) NOT NULL,              -- 상대 시스템 (화주 ERP/화물정보망 ...)
    direction           ntms.interface_direction NOT NULL,
    protocol            VARCHAR(20)  NOT NULL DEFAULT 'REST',   -- REST/SOAP/FTP/SFTP/EDI/DB_LINK
    endpoint_url        VARCHAR(500),
    auth_type           VARCHAR(30),                        -- NONE/BASIC/BEARER/HMAC/MTLS
    schedule_cron       VARCHAR(50),                        -- 주기 연계 스케줄
    timeout_seconds     INTEGER      NOT NULL DEFAULT 30,
    retry_limit         SMALLINT     NOT NULL DEFAULT 3,
    mapping_rule        JSONB,                              -- 필드 매핑 정의
    is_active           BOOLEAN      NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT uk_interface_master UNIQUE (tenant_id, interface_code)
);

COMMENT ON TABLE ntms.interface_master IS '외부 시스템 연계 정의 (통합 연계 대상)';

CREATE TABLE ntms.interface_log (
    interface_log_id    BIGINT GENERATED ALWAYS AS IDENTITY,
    tenant_id           BIGINT,
    interface_code      VARCHAR(50)  NOT NULL,
    direction           ntms.interface_direction NOT NULL,
    partner_system      VARCHAR(100),
    transaction_key     VARCHAR(100),                       -- 상대 시스템 거래 키 (중복 판정)
    ref_type            VARCHAR(50),
    ref_id              BIGINT,
    request_data        JSONB,
    response_data       JSONB,
    status              ntms.interface_status NOT NULL,
    error_code          VARCHAR(50),
    error_message       VARCHAR(1000),
    retry_count         SMALLINT     NOT NULL DEFAULT 0,
    request_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    response_at         TIMESTAMPTZ,
    elapsed_ms          INTEGER,                            -- 소요시간(ms)
    PRIMARY KEY (interface_log_id, request_at)
) PARTITION BY RANGE (request_at);

CREATE INDEX ix_interface_log_code   ON ntms.interface_log (interface_code, request_at DESC);
CREATE INDEX ix_interface_log_status ON ntms.interface_log (status, request_at DESC) WHERE status IN ('FAILED','RETRY');
CREATE INDEX ix_interface_log_txkey  ON ntms.interface_log (transaction_key) WHERE transaction_key IS NOT NULL;

COMMENT ON TABLE ntms.interface_log IS '외부 연계 송수신 로그 (월 단위 파티션)';

-- =====================================================================
-- 11. 배치
-- =====================================================================
CREATE TABLE ntms.batch_job (
    batch_job_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           BIGINT       REFERENCES ntms.tenant(tenant_id),  -- NULL = 전역 배치
    job_code            VARCHAR(50)  NOT NULL,
    job_name            VARCHAR(200) NOT NULL,
    job_group           VARCHAR(50),
    schedule_cron       VARCHAR(50),
    parameter           JSONB,
    timeout_seconds     INTEGER      NOT NULL DEFAULT 3600,
    is_active           BOOLEAN      NOT NULL DEFAULT true,
    last_run_at         TIMESTAMPTZ,
    last_status         ntms.batch_status,
    next_run_at         TIMESTAMPTZ,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          BIGINT,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    row_version         INTEGER      NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX ux_batch_job_code ON ntms.batch_job (COALESCE(tenant_id, 0), job_code);

COMMENT ON TABLE ntms.batch_job IS '배치 작업 정의';

CREATE TABLE ntms.batch_job_log (
    batch_job_log_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_job_id        BIGINT       NOT NULL REFERENCES ntms.batch_job(batch_job_id),
    tenant_id           BIGINT,
    started_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    finished_at         TIMESTAMPTZ,
    status              ntms.batch_status NOT NULL DEFAULT 'RUNNING',
    target_count        INTEGER,                            -- 처리 대상 건수
    success_count       INTEGER,
    fail_count          INTEGER,
    error_message       VARCHAR(2000),
    execution_log       TEXT,
    executed_by         BIGINT                              -- 수동 실행자
);

CREATE INDEX ix_batch_job_log ON ntms.batch_job_log (batch_job_id, started_at DESC);

COMMENT ON TABLE ntms.batch_job_log IS '배치 실행 이력';
