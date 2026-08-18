-- =====================================================================
-- NTMS : 01_enum.sql
-- 업무 흐름상 값이 고정된 상태/구분 코드를 ENUM 타입으로 정의한다.
--
-- ENUM  : 워크플로 분기에 직접 쓰이는 안정적 상태값 (코드 변경 = 로직 변경)
-- code  : 테넌트가 자유롭게 추가/변경하는 분류값 (ntms.code 테이블 사용)
--
-- 값 추가는 ALTER TYPE ... ADD VALUE 로 가능하나, 삭제는 불가하므로
-- 신규 상태 도입 시 반드시 상태 전이 규칙 문서를 함께 갱신할 것.
-- =====================================================================

SET search_path TO ntms, public;

-- ---------------------------------------------------------------------
-- 시스템 / 인증
-- ---------------------------------------------------------------------
CREATE TYPE ntms.tenant_status AS ENUM (
    'ACTIVE',       -- 정상
    'SUSPENDED',    -- 일시정지 (미납/위반)
    'TERMINATED'    -- 계약종료
);

CREATE TYPE ntms.user_status AS ENUM (
    'ACTIVE',       -- 정상
    'LOCKED',       -- 잠김 (로그인 실패 초과)
    'DORMANT',      -- 휴면 (장기 미접속)
    'SUSPENDED',    -- 정지 (관리자 조치)
    'WITHDRAWN'     -- 탈퇴
);

CREATE TYPE ntms.user_type AS ENUM (
    'INTERNAL',     -- 내부 임직원
    'SHIPPER',      -- 화주 담당자
    'CARRIER',      -- 운송사 담당자
    'DRIVER',       -- 차량 기사 (모바일)
    'SYSTEM'        -- 연계/배치 전용 계정
);

CREATE TYPE ntms.login_result AS ENUM (
    'SUCCESS',
    'FAIL_PASSWORD',    -- 비밀번호 불일치
    'FAIL_NOT_FOUND',   -- 미존재 계정
    'FAIL_LOCKED',      -- 잠김 계정
    'FAIL_DORMANT',     -- 휴면 계정
    'FAIL_EXPIRED',     -- 비밀번호 만료
    'FAIL_MFA',         -- 2차 인증 실패
    'FAIL_TENANT'       -- 테넌트 비활성
);

CREATE TYPE ntms.audit_action AS ENUM ('INSERT', 'UPDATE', 'DELETE');

CREATE TYPE ntms.approval_status AS ENUM (
    'DRAFT',        -- 작성중
    'REQUESTED',    -- 상신
    'APPROVED',     -- 승인
    'REJECTED',     -- 반려
    'CANCELLED'     -- 취소
);

CREATE TYPE ntms.interface_direction AS ENUM ('INBOUND', 'OUTBOUND');

CREATE TYPE ntms.interface_status AS ENUM (
    'RECEIVED',     -- 수신
    'PROCESSING',   -- 처리중
    'SUCCESS',      -- 성공
    'FAILED',       -- 실패
    'RETRY',        -- 재시도 대기
    'SKIPPED'       -- 무시(중복 등)
);

CREATE TYPE ntms.batch_status AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED');

CREATE TYPE ntms.notify_channel AS ENUM ('SMS', 'LMS', 'KAKAO_ALIMTALK', 'EMAIL', 'PUSH', 'IN_APP');

CREATE TYPE ntms.notify_status  AS ENUM ('PENDING', 'SENT', 'FAILED', 'READ');

-- ---------------------------------------------------------------------
-- 마스터
-- ---------------------------------------------------------------------
CREATE TYPE ntms.location_type AS ENUM (
    'WAREHOUSE',    -- 창고
    'PLANT',        -- 공장
    'DC',           -- 물류센터
    'HUB',          -- 허브 터미널
    'STORE',        -- 점포
    'CUSTOMER',     -- 고객 인도지
    'PORT',         -- 항만
    'AIRPORT',      -- 공항
    'RAIL_TERMINAL',-- 철도역
    'PARKING',      -- 차고지
    'ETC'
);

CREATE TYPE ntms.vehicle_body_type AS ENUM (
    'CARGO',        -- 카고
    'WING',         -- 윙바디
    'TOP',          -- 탑차
    'REEFER',       -- 냉장/냉동
    'TANK',         -- 탱크로리
    'TRAILER',      -- 트레일러
    'FLATBED',      -- 평판
    'DUMP',         -- 덤프
    'CONTAINER',    -- 컨테이너 섀시
    'VAN',          -- 밴/승합
    'ETC'
);

CREATE TYPE ntms.vehicle_ownership AS ENUM (
    'OWNED',        -- 직영 (자사 소유)
    'CONSIGNED',    -- 지입
    'CONTRACTED',   -- 계약 운송사 차량
    'SPOT'          -- 용차 (일시)
);

CREATE TYPE ntms.vehicle_status AS ENUM (
    'AVAILABLE',    -- 가용
    'IN_USE',       -- 운행중
    'MAINTENANCE',  -- 정비중
    'IDLE',         -- 휴차
    'DISPOSED'      -- 폐차/매각
);

CREATE TYPE ntms.fuel_type AS ENUM ('DIESEL', 'GASOLINE', 'LPG', 'CNG', 'ELECTRIC', 'HYDROGEN', 'HYBRID');

CREATE TYPE ntms.driver_status AS ENUM ('ACTIVE', 'LEAVE', 'SUSPENDED', 'RESIGNED');

CREATE TYPE ntms.partner_grade AS ENUM ('S', 'A', 'B', 'C', 'D');

CREATE TYPE ntms.contract_status AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED');

-- ---------------------------------------------------------------------
-- 운임 / 요율
-- ---------------------------------------------------------------------
CREATE TYPE ntms.rate_target AS ENUM (
    'BILLING',      -- 매출 (화주 청구용)
    'PAYMENT'       -- 매입 (운송사 지급용)
);

CREATE TYPE ntms.rate_method AS ENUM (
    'FIXED',        -- 정액
    'DISTANCE',     -- 거리 구간
    'ZONE',         -- 권역 대 권역
    'WEIGHT',       -- 중량 구간
    'VOLUME',       -- 부피 구간
    'PALLET',       -- 팔레트 수
    'QTY',          -- 수량
    'TON_KM',       -- 톤·킬로
    'PER_STOP',     -- 정차지 단위
    'PER_TRIP',     -- 트립 단위
    'PERCENT'       -- 물품가액 비율
);

CREATE TYPE ntms.charge_method AS ENUM (
    'FIXED',        -- 정액
    'PER_UNIT',     -- 단위당
    'PER_HOUR',     -- 시간당
    'PER_MINUTE',   -- 분당
    'PERCENT'       -- 기본운임 대비 비율
);

-- ---------------------------------------------------------------------
-- 운송오더
-- ---------------------------------------------------------------------
CREATE TYPE ntms.order_type AS ENUM (
    'DELIVERY',     -- 출고 배송
    'PICKUP',       -- 집화
    'RETURN',       -- 반품 회수
    'TRANSFER',     -- 지점간 이고
    'MILKRUN',      -- 순회 집화
    'CROSSDOCK'     -- 크로스도킹
);

CREATE TYPE ntms.order_status AS ENUM (
    'DRAFT',        -- 임시저장
    'RECEIVED',     -- 접수
    'CONFIRMED',    -- 확정 (계획 대상)
    'PLANNED',      -- 편성 완료
    'ALLOCATED',    -- 운송사 배정 완료
    'DISPATCHED',   -- 배차 완료
    'PICKED_UP',    -- 상차 완료
    'IN_TRANSIT',   -- 운송중
    'DELIVERED',    -- 하차/인도 완료
    'CONFIRMED_POD',-- 인수증 확인 완료
    'SETTLED',      -- 정산 완료
    'CANCELLED',    -- 취소
    'ON_HOLD',      -- 보류
    'RETURNED',     -- 반송
    'FAILED'        -- 배송 실패
);

CREATE TYPE ntms.freight_terms AS ENUM (
    'PREPAID',      -- 선불 (발송인 부담)
    'COLLECT',      -- 착불 (수하인 부담)
    'CREDIT',       -- 신용 (월 정산)
    'THIRD_PARTY'   -- 제3자 부담
);

CREATE TYPE ntms.appointment_type AS ENUM (
    'ASAP',         -- 즉시
    'WINDOW',       -- 희망 시간대
    'APPOINTMENT',  -- 확정 예약시각
    'FIXED_ROUTE'   -- 고정 배송 스케줄
);

CREATE TYPE ntms.order_priority AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

CREATE TYPE ntms.temperature_zone AS ENUM (
    'AMBIENT',      -- 상온
    'CHILLED',      -- 냉장
    'FROZEN',       -- 냉동
    'DEEP_FROZEN'   -- 초저온
);

-- ---------------------------------------------------------------------
-- 운송계획 (편성 / 배정 / 배차)
-- ---------------------------------------------------------------------
CREATE TYPE ntms.transport_mode AS ENUM ('ROAD', 'RAIL', 'SEA', 'AIR', 'MULTIMODAL');

CREATE TYPE ntms.trip_type AS ENUM (
    'SINGLE',       -- 단건 직행
    'CONSOLIDATED', -- 혼적 (다수 오더 합적)
    'MILKRUN',      -- 순회
    'SHUTTLE',      -- 셔틀 (왕복 반복)
    'RELAY'         -- 중계 (구간 분할)
);

CREATE TYPE ntms.trip_status AS ENUM (
    'DRAFT',        -- 편성 임시
    'CONFIRMED',    -- 편성 확정
    'ALLOCATING',   -- 배정 진행중
    'ALLOCATED',    -- 배정 완료
    'DISPATCHED',   -- 배차 완료
    'EXECUTING',    -- 운송 실행중
    'COMPLETED',    -- 운송 완료
    'CLOSED',       -- 실적 확정
    'CANCELLED'     -- 취소
);

CREATE TYPE ntms.stop_type AS ENUM (
    'PICKUP',       -- 상차
    'DELIVERY',     -- 하차
    'WAYPOINT',     -- 경유
    'REST',         -- 휴게
    'FUEL',         -- 주유
    'CROSSDOCK'     -- 환적
);

CREATE TYPE ntms.stop_status AS ENUM (
    'PENDING',      -- 미도착
    'ARRIVED',      -- 도착
    'SERVICING',    -- 작업중
    'COMPLETED',    -- 완료
    'SKIPPED',      -- 건너뜀
    'FAILED'        -- 실패
);

CREATE TYPE ntms.allocation_type AS ENUM (
    'DIRECT',       -- 지정 배정
    'ROTATION',     -- 순번 배정
    'BIDDING',      -- 입찰
    'AUTO',         -- 시스템 자동(최적화)
    'SPOT'          -- 용차 수배
);

CREATE TYPE ntms.allocation_status AS ENUM (
    'REQUESTED',    -- 배정 요청
    'ACCEPTED',     -- 운송사 수락
    'REJECTED',     -- 운송사 거절
    'EXPIRED',      -- 응답기한 초과
    'CANCELLED',    -- 요청 취소
    'REASSIGNED'    -- 타 운송사로 재배정됨
);

CREATE TYPE ntms.bid_status AS ENUM ('OPEN', 'SUBMITTED', 'WON', 'LOST', 'WITHDRAWN', 'CLOSED');

CREATE TYPE ntms.dispatch_type AS ENUM (
    'OWN',          -- 직영차
    'CONSIGNED',    -- 지입차
    'CONTRACTED',   -- 계약 운송사
    'SPOT'          -- 용차
);

CREATE TYPE ntms.dispatch_status AS ENUM (
    'ASSIGNED',     -- 배차 지정
    'NOTIFIED',     -- 기사 통보
    'ACCEPTED',     -- 기사 수락
    'REJECTED',     -- 기사 거절
    'CONFIRMED',    -- 배차 확정
    'STARTED',      -- 운행 시작
    'COMPLETED',    -- 운행 완료
    'CANCELLED'     -- 배차 취소
);

CREATE TYPE ntms.dispatch_change_type AS ENUM (
    'VEHICLE_CHANGE',   -- 차량 교체
    'DRIVER_CHANGE',    -- 기사 교체
    'CARRIER_CHANGE',   -- 운송사 교체
    'SCHEDULE_CHANGE',  -- 일정 변경
    'CANCEL'            -- 취소
);

-- ---------------------------------------------------------------------
-- 운송실행
-- ---------------------------------------------------------------------
CREATE TYPE ntms.execution_status AS ENUM (
    'READY',        -- 대기
    'DEPARTED',     -- 출고지 출발
    'IN_TRANSIT',   -- 운행중
    'ARRIVED',      -- 도착
    'UNLOADING',    -- 하차중
    'COMPLETED',    -- 완료
    'SUSPENDED',    -- 중단
    'CANCELLED'     -- 취소
);

CREATE TYPE ntms.execution_event_type AS ENUM (
    'TRIP_START',   -- 운행 시작
    'DEPART',       -- 출발
    'ARRIVE',       -- 도착
    'LOAD_START',   -- 상차 시작
    'LOAD_END',     -- 상차 완료
    'UNLOAD_START', -- 하차 시작
    'UNLOAD_END',   -- 하차 완료
    'WAIT_START',   -- 대기 시작
    'WAIT_END',     -- 대기 종료
    'REST_START',   -- 휴게 시작
    'REST_END',     -- 휴게 종료
    'REFUEL',       -- 주유
    'DELAY',        -- 지연 발생
    'EXCEPTION',    -- 예외 발생
    'TRIP_END'      -- 운행 종료
);

CREATE TYPE ntms.gps_source AS ENUM ('GPS_DEVICE', 'DTG', 'MOBILE_APP', 'MANUAL', 'CARRIER_API');

CREATE TYPE ntms.pod_type AS ENUM ('SIGNATURE', 'PHOTO', 'STAMP', 'EDI', 'PAPER', 'PIN_CODE');

CREATE TYPE ntms.pod_result AS ENUM (
    'NORMAL',       -- 정상 인수
    'PARTIAL',      -- 일부 인수
    'DAMAGED',      -- 파손
    'SHORTAGE',     -- 수량 부족
    'REFUSED',      -- 인수 거부
    'ABSENT',       -- 부재
    'MISDELIVERY'   -- 오배송
);

CREATE TYPE ntms.exception_type AS ENUM (
    'DELAY',            -- 지연
    'TRAFFIC',          -- 교통정체
    'WEATHER',          -- 기상
    'ACCIDENT',         -- 사고
    'BREAKDOWN',        -- 차량고장
    'CARGO_DAMAGE',     -- 화물파손
    'CARGO_LOSS',       -- 화물분실
    'CUSTOMER_ABSENT',  -- 수하인 부재
    'ADDRESS_ERROR',    -- 주소오류
    'LOADING_DELAY',    -- 상하차 지연
    'DOCUMENT',         -- 서류문제
    'ETC'
);

CREATE TYPE ntms.exception_severity AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

CREATE TYPE ntms.exception_status AS ENUM ('REPORTED', 'INVESTIGATING', 'ACTION_TAKEN', 'RESOLVED', 'CLOSED');

-- ---------------------------------------------------------------------
-- 실적 / 정산
-- ---------------------------------------------------------------------
CREATE TYPE ntms.actual_confirm_status AS ENUM (
    'DRAFT',        -- 실적 생성 (미확정)
    'REVIEWING',    -- 검수중
    'CONFIRMED',    -- 확정
    'CLOSED',       -- 마감 (수정 불가)
    'REOPENED'      -- 마감 해제
);

CREATE TYPE ntms.settlement_type AS ENUM (
    'BILLING',      -- 매출 정산 (화주 청구)
    'PAYMENT'       -- 매입 정산 (운송사 지급)
);

CREATE TYPE ntms.settlement_status AS ENUM (
    'DRAFT',        -- 정산 생성
    'CALCULATED',   -- 운임 산출 완료
    'REVIEWING',    -- 검수/이의 확인중
    'CONFIRMED',    -- 확정
    'APPROVED',     -- 승인
    'INVOICED',     -- 세금계산서 발행
    'PARTIALLY_PAID', -- 부분 수납/지급
    'PAID',         -- 완납
    'CLOSED',       -- 마감
    'CANCELLED'     -- 취소
);

CREATE TYPE ntms.adjustment_type AS ENUM (
    'ADD',          -- 추가 청구
    'DEDUCT',       -- 차감
    'DISCOUNT',     -- 할인
    'PENALTY',      -- 지체상금/페널티
    'CLAIM',        -- 손해배상 구상
    'CORRECTION'    -- 오류 정정
);

CREATE TYPE ntms.tax_invoice_type AS ENUM (
    'TAX',          -- 세금계산서
    'EXEMPT',       -- 계산서(면세)
    'MODIFIED'      -- 수정 세금계산서
);

CREATE TYPE ntms.tax_invoice_status AS ENUM (
    'DRAFT',        -- 작성
    'ISSUED',       -- 발행
    'SENT',         -- 국세청 전송
    'ACCEPTED',     -- 국세청 승인
    'REJECTED',     -- 국세청 반려
    'CANCELLED'     -- 취소
);

CREATE TYPE ntms.payment_direction AS ENUM ('RECEIPT', 'DISBURSEMENT');  -- 입금 / 출금

CREATE TYPE ntms.payment_method AS ENUM (
    'BANK_TRANSFER',-- 계좌이체
    'CARD',         -- 카드
    'CHECK',        -- 어음/수표
    'CASH',         -- 현금
    'OFFSET',       -- 상계
    'ETC'
);

CREATE TYPE ntms.close_status AS ENUM ('OPEN', 'CLOSED', 'REOPENED');
