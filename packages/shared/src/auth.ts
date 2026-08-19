/**
 * 인증 · 계정신청 DTO 스키마.
 *
 * Nest.js 는 ZodValidationPipe 로, Next.js 는 react-hook-form resolver 로
 * 여기 있는 스키마 한 벌을 그대로 쓴다. 비밀번호 규칙 같은 것이 서버와
 * 화면에서 따로 굴러가면, 화면은 통과시키고 서버는 거절하는 상태가 된다.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------
// 원시 필드
// ---------------------------------------------------------------------

/**
 * 회사 코드 = ntms.tenant.tenant_code.
 * DB 에 ck_tenant_code_upper 제약(대문자만)이 걸려 있어 여기서도 대문자로 맞춘다.
 */
export const tenantCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, '회사 코드는 2자 이상입니다')
  .max(20, '회사 코드는 20자 이하입니다')
  .regex(/^[A-Z0-9][A-Z0-9_-]*$/, '영문 대문자 · 숫자 · - _ 만 쓸 수 있습니다');

export const loginIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(4, '아이디는 4자 이상입니다')
  .max(100, '아이디는 100자 이하입니다')
  .regex(
    /^[a-z][a-z0-9._-]*$/,
    '영문 소문자로 시작하고 영문 · 숫자 · . _ - 만 쓸 수 있습니다',
  );

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, '이메일을 입력하세요')
  .max(200, '이메일은 200자 이하입니다')
  .email('이메일 형식이 올바르지 않습니다');

export const mobileSchema = z
  .string()
  .trim()
  .regex(/^01[016789]-?\d{3,4}-?\d{4}$/, '휴대폰 번호 형식이 올바르지 않습니다');

export const userNameSchema = z
  .string()
  .trim()
  .min(2, '이름은 2자 이상입니다')
  .max(100, '이름은 100자 이하입니다');

// ---------------------------------------------------------------------
// 비밀번호 정책
//
// 국내 기업 보안기준(3종 조합)을 그대로 따른다. 규칙을 상수로 빼 둔 이유는
// 화면의 안내 문구와 서버 검증이 같은 값을 읽게 하기 위해서다.
// ---------------------------------------------------------------------
export const PASSWORD_POLICY = {
  minLength: 10,
  maxLength: 64,
  /** 대문자 · 소문자 · 숫자 · 특수문자 중 몇 종을 섞어야 하는가 */
  minCharClasses: 3,
  /** 같은 문자 연속 허용 횟수 (aaa 금지) */
  maxRepeat: 2,
} as const;

const SPECIAL_CHAR = /[^A-Za-z0-9]/;

/** 비밀번호에 섞인 문자 종류 수 (대문자 · 소문자 · 숫자 · 특수문자) */
export function countCharClasses(password: string): number {
  const tests = [/[A-Z]/, /[a-z]/, /[0-9]/, SPECIAL_CHAR];
  return tests.filter((re) => re.test(password)).length;
}

/** 같은 문자가 3번 이상 연달아 나오는가 */
export function hasRepeatRun(password: string): boolean {
  return new RegExp('(.)\\1{' + PASSWORD_POLICY.maxRepeat + '}').test(password);
}

/** abc / 123 / cba 처럼 3자 이상 이어지는 문자열인가 */
export function hasSequentialRun(password: string): boolean {
  const s = password.toLowerCase();
  for (let i = 0; i + 2 < s.length; i += 1) {
    const a = s.charCodeAt(i);
    const b = s.charCodeAt(i + 1);
    const c = s.charCodeAt(i + 2);
    if (b - a === 1 && c - b === 1) return true;
    if (a - b === 1 && b - c === 1) return true;
  }
  return false;
}

export const passwordSchema = z
  .string()
  .min(
    PASSWORD_POLICY.minLength,
    PASSWORD_POLICY.minLength + '자 이상 입력하세요',
  )
  .max(
    PASSWORD_POLICY.maxLength,
    PASSWORD_POLICY.maxLength + '자 이하로 입력하세요',
  )
  .refine(
    (v) => countCharClasses(v) >= PASSWORD_POLICY.minCharClasses,
    '영문 대문자 · 소문자 · 숫자 · 특수문자 중 3종 이상을 섞으세요',
  )
  .refine((v) => !hasRepeatRun(v), '같은 문자를 3번 이상 연달아 쓸 수 없습니다')
  .refine(
    (v) => !hasSequentialRun(v),
    'abc · 123 처럼 이어지는 문자열은 쓸 수 없습니다',
  );

export type PasswordStrength = 'weak' | 'fair' | 'strong';

export interface PasswordAssessment {
  /** 0-4. 강도 표시의 눈금 4칸과 1:1 로 대응한다 */
  score: 0 | 1 | 2 | 3 | 4;
  strength: PasswordStrength;
  /** 아직 만족하지 못한 규칙. 화면에 그대로 나열한다 */
  unmet: string[];
}

/**
 * 비밀번호 강도 평가.
 * 통과/불통과는 passwordSchema 가 판단하고, 이 함수는 "얼마나 여유가 있는가" 만 본다.
 */
export function assessPassword(password: string): PasswordAssessment {
  const unmet: string[] = [];
  if (password.length < PASSWORD_POLICY.minLength) {
    unmet.push(PASSWORD_POLICY.minLength + '자 이상');
  }
  if (countCharClasses(password) < PASSWORD_POLICY.minCharClasses) {
    unmet.push('영문 · 숫자 · 특수문자 3종 조합');
  }
  if (hasRepeatRun(password) || hasSequentialRun(password)) {
    unmet.push('반복 · 연속 문자 제외');
  }

  let score = 0;
  if (password.length >= PASSWORD_POLICY.minLength) score += 1;
  if (password.length >= 14) score += 1;
  if (countCharClasses(password) >= 3) score += 1;
  if (countCharClasses(password) === 4) score += 1;
  if (unmet.length > 0) score = Math.min(score, 1);

  const clamped = Math.max(0, Math.min(4, score)) as PasswordAssessment['score'];
  const strength: PasswordStrength =
    clamped >= 4 ? 'strong' : clamped >= 2 ? 'fair' : 'weak';

  return { score: clamped, strength, unmet };
}

export const PASSWORD_STRENGTH_LABEL: Record<PasswordStrength, string> = {
  weak: '약함',
  fair: '보통',
  strong: '안전',
};

// ---------------------------------------------------------------------
// 요청 스키마
// ---------------------------------------------------------------------

export const tenantLookupSchema = z.object({
  tenantCode: tenantCodeSchema,
});

export const loginSchema = z.object({
  tenantCode: tenantCodeSchema,
  loginId: loginIdSchema,
  /**
   * 로그인 시점에는 비밀번호 정책을 검증하지 않는다.
   * 규칙이 강화되기 전에 만들어진 비밀번호로도 들어와야 하기 때문이다.
   * (정책 위반은 로그인 성공 후 변경 안내로 처리한다)
   */
  password: z
    .string()
    .min(1, '비밀번호를 입력하세요')
    .max(PASSWORD_POLICY.maxLength),
  /** 켜면 리프레시 토큰 수명이 길어진다 */
  rememberMe: z.boolean().default(false),
});

/** 계정신청 1단계 — 회사 확인 */
export const signupStep1Schema = z.object({
  tenantCode: tenantCodeSchema,
  email: emailSchema,
});

/** 계정신청 2단계 — 담당자 정보 */
export const signupStep2Schema = z.object({
  userName: userNameSchema,
  deptName: z.string().trim().max(100).optional(),
  mobile: mobileSchema,
  loginId: loginIdSchema,
  password: passwordSchema,
  passwordConfirm: z.string().min(1, '비밀번호를 한 번 더 입력하세요'),
  agreeTerms: z.literal(true, {
    errorMap: () => ({ message: '이용약관에 동의해야 신청할 수 있습니다' }),
  }),
  agreePrivacy: z.literal(true, {
    errorMap: () => ({
      message: '개인정보 수집·이용에 동의해야 신청할 수 있습니다',
    }),
  }),
  agreeMarketing: z.boolean().default(false),
});

const signupBaseSchema = signupStep1Schema.merge(signupStep2Schema);

export const signupSchema = signupBaseSchema
  .refine((v) => v.password === v.passwordConfirm, {
    message: '비밀번호가 서로 다릅니다',
    path: ['passwordConfirm'],
  })
  .refine((v) => !v.password.toLowerCase().includes(v.loginId.toLowerCase()), {
    message: '비밀번호에 아이디를 포함할 수 없습니다',
    path: ['password'],
  });

/**
 * 비밀번호 변경.
 *
 * 현재 비밀번호를 다시 묻는 이유는, 자리를 비운 사이 남이 브라우저를 잡았을 때
 * 계정을 통째로 빼앗기지 않게 하기 위해서다. 액세스 토큰만으로는 부족하다.
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, '현재 비밀번호를 입력하세요')
      .max(PASSWORD_POLICY.maxLength),
    newPassword: passwordSchema,
    newPasswordConfirm: z.string().min(1, '새 비밀번호를 한 번 더 입력하세요'),
  })
  .refine((v) => v.newPassword === v.newPasswordConfirm, {
    message: '비밀번호가 서로 다릅니다',
    path: ['newPasswordConfirm'],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: '지금 쓰는 비밀번호와 다른 것으로 정하세요',
    path: ['newPassword'],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export type TenantLookupInput = z.infer<typeof tenantLookupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type SignupStep1Input = z.infer<typeof signupStep1Schema>;
export type SignupStep2Input = z.infer<typeof signupStep2Schema>;
export type SignupInput = z.infer<typeof signupSchema>;

// ---------------------------------------------------------------------
// 응답 타입
// ---------------------------------------------------------------------

export interface TenantSummary {
  tenantCode: string;
  tenantName: string;
}

export interface AuthUser {
  /** BIGINT PK 는 JSON 왕복에서 정밀도가 깨지므로 문자열로 주고받는다 */
  userId: string;
  userUuid: string;
  loginId: string;
  userName: string;
  email: string | null;
  userType: string;
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  roles: string[];
  permissions: string[];
  /** 비밀번호를 바꿔야 다음 화면으로 갈 수 있는 상태인가 */
  mustChangePassword: boolean;
  /** 만료까지 남은 일수. null 이면 만료 정책 없음 */
  passwordExpiresInDays: number | null;
  /** 직전 접속 시각. 본인이 아닌 접속을 알아채는 단서다 */
  lastLoginAt: string | null;
}

export interface LoginResult {
  accessToken: string;
  /** 초 단위. 클라이언트가 만료 전에 갱신하는 데 쓴다 */
  expiresIn: number;
  user: AuthUser;
}

export interface SignupResult {
  status: 'PENDING';
  tenantName: string;
  loginId: string;
  /** 승인 결과를 받을 주소. 신청 완료 화면에 그대로 보여준다 */
  email: string;
}

// ---------------------------------------------------------------------
// 오류 코드
//
// 서버가 코드를, 화면이 문구를 책임진다. 서버 메시지를 그대로 화면에 흘리면
// 문구를 고칠 때마다 서버를 배포해야 하고, 내부 사정이 노출되기도 한다.
// ---------------------------------------------------------------------
export const AUTH_ERROR = {
  INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  TENANT_NOT_FOUND: 'AUTH_TENANT_NOT_FOUND',
  TENANT_INACTIVE: 'AUTH_TENANT_INACTIVE',
  ACCOUNT_PENDING: 'AUTH_ACCOUNT_PENDING',
  ACCOUNT_LOCKED: 'AUTH_ACCOUNT_LOCKED',
  ACCOUNT_DORMANT: 'AUTH_ACCOUNT_DORMANT',
  ACCOUNT_SUSPENDED: 'AUTH_ACCOUNT_SUSPENDED',
  ACCOUNT_WITHDRAWN: 'AUTH_ACCOUNT_WITHDRAWN',
  PASSWORD_EXPIRED: 'AUTH_PASSWORD_EXPIRED',
  CURRENT_PASSWORD_WRONG: 'AUTH_CURRENT_PASSWORD_WRONG',
  PASSWORD_UNCHANGED: 'AUTH_PASSWORD_UNCHANGED',
  SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',
  SESSION_REUSED: 'AUTH_SESSION_REUSED',
  SESSION_PASSWORD_CHANGED: 'AUTH_SESSION_PASSWORD_CHANGED',
  TOO_MANY_ATTEMPTS: 'AUTH_TOO_MANY_ATTEMPTS',
  LOGIN_ID_TAKEN: 'AUTH_LOGIN_ID_TAKEN',
  EMAIL_TAKEN: 'AUTH_EMAIL_TAKEN',
  SIGNUP_CLOSED: 'AUTH_SIGNUP_CLOSED',
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR)[keyof typeof AUTH_ERROR];

/** 오류 문구. 원인과 다음에 할 일을 함께 적는다 */
export const AUTH_ERROR_MESSAGE: Record<AuthErrorCode, string> = {
  [AUTH_ERROR.INVALID_CREDENTIALS]: '아이디 또는 비밀번호가 일치하지 않습니다.',
  [AUTH_ERROR.TENANT_NOT_FOUND]:
    '등록되지 않은 회사 코드입니다. 사내 시스템 담당자에게 확인해 주세요.',
  [AUTH_ERROR.TENANT_INACTIVE]:
    '이 회사의 서비스 이용이 중지된 상태입니다. 사내 시스템 담당자에게 문의해 주세요.',
  [AUTH_ERROR.ACCOUNT_PENDING]:
    '승인 대기 중인 계정입니다. 관리자 승인 후 로그인할 수 있습니다.',
  [AUTH_ERROR.ACCOUNT_LOCKED]:
    '비밀번호를 여러 번 틀려 계정이 잠겼습니다. 관리자에게 잠금 해제를 요청해 주세요.',
  [AUTH_ERROR.ACCOUNT_DORMANT]:
    '장기 미접속으로 휴면 상태입니다. 관리자에게 휴면 해제를 요청해 주세요.',
  [AUTH_ERROR.ACCOUNT_SUSPENDED]: '사용이 정지된 계정입니다. 관리자에게 문의해 주세요.',
  [AUTH_ERROR.ACCOUNT_WITHDRAWN]: '탈퇴 처리된 계정입니다. 계정을 다시 신청해 주세요.',
  [AUTH_ERROR.PASSWORD_EXPIRED]:
    '비밀번호 유효기간이 지났습니다. 비밀번호를 변경한 뒤 로그인해 주세요.',
  [AUTH_ERROR.CURRENT_PASSWORD_WRONG]: '현재 비밀번호가 일치하지 않습니다.',
  [AUTH_ERROR.PASSWORD_UNCHANGED]:
    '지금 쓰는 비밀번호와 같습니다. 다른 비밀번호로 정해 주세요.',
  [AUTH_ERROR.SESSION_EXPIRED]: '로그인 유효시간이 지났습니다. 다시 로그인해 주세요.',
  [AUTH_ERROR.SESSION_REUSED]:
    '보안을 위해 모든 기기에서 로그아웃했습니다. 다시 로그인해 주세요.',
  [AUTH_ERROR.SESSION_PASSWORD_CHANGED]:
    '비밀번호가 변경되어 이 기기에서 로그아웃되었습니다. 새 비밀번호로 다시 로그인해 주세요.',
  [AUTH_ERROR.TOO_MANY_ATTEMPTS]: '시도가 너무 잦습니다. 잠시 후 다시 해 주세요.',
  [AUTH_ERROR.LOGIN_ID_TAKEN]: '이미 사용 중인 아이디입니다. 다른 아이디를 입력해 주세요.',
  [AUTH_ERROR.EMAIL_TAKEN]:
    '이미 신청된 이메일입니다. 승인 상태는 관리자에게 확인해 주세요.',
  [AUTH_ERROR.SIGNUP_CLOSED]:
    '이 회사는 계정 신청을 받지 않습니다. 사내 시스템 담당자에게 문의해 주세요.',
};

export function authErrorMessage(code: string | undefined, fallback: string): string {
  if (code && code in AUTH_ERROR_MESSAGE) {
    return AUTH_ERROR_MESSAGE[code as AuthErrorCode];
  }
  return fallback;
}
