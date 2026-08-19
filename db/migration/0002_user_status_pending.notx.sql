-- =====================================================================
-- 0002 : 승인 대기 상태 추가
--
--   user_status.PENDING       계정 신청은 접수됐으나 아직 승인 전
--   login_result.FAIL_PENDING 그 상태로 로그인을 시도한 기록
--
-- 기존 값만으로는 "신청했지만 아직 승인되지 않은 계정" 을 표현할 수 없다.
-- SUSPENDED(관리자가 정지시킴) 로 대신 쓰면 보안 감사에서 두 사건이
-- 구분되지 않는다. 승인 대기와 징계성 정지는 다른 사건이다.
--
-- ALTER TYPE ... ADD VALUE 로 추가한 값은 같은 트랜잭션 안에서 쓸 수 없다.
-- 파일명을 .notx.sql 로 두어 트랜잭션 밖에서 실행한다.
--
-- 정본 : db/ddl/01_enum.sql
-- =====================================================================

ALTER TYPE ntms.user_status  ADD VALUE IF NOT EXISTS 'PENDING'      BEFORE 'ACTIVE';
ALTER TYPE ntms.login_result ADD VALUE IF NOT EXISTS 'FAIL_PENDING' BEFORE 'FAIL_LOCKED';
