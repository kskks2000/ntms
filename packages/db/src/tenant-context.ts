import type { PrismaClient, Prisma } from '@prisma/client';

/**
 * 요청 1건의 테넌트/사용자 컨텍스트.
 * 인증 미들웨어가 검증한 토큰에서만 만들어져야 한다.
 */
export interface TenantContext {
  tenantId: bigint;
  userId: bigint;
  clientIp?: string;
}

/** DB 세션 GUC 로 주입 가능한 트랜잭션 클라이언트 */
export type TxClient = Prisma.TransactionClient;

/**
 * BIGINT 로 안전하게 변환한다.
 *
 * SET LOCAL 은 파라미터 바인딩을 지원하지 않아 문자열 보간이 불가피하다.
 * 따라서 값이 정수임을 여기서 반드시 보장해야 한다.
 * 이 검증이 SQL 인젝션에 대한 유일한 방어선이다.
 */
function toSafeBigInt(value: bigint | number | string, field: string): bigint {
  let parsed: bigint;
  try {
    parsed = typeof value === 'bigint' ? value : BigInt(value);
  } catch {
    throw new Error(`${field} 가 정수가 아닙니다: ${String(value)}`);
  }
  if (parsed <= 0n) {
    throw new Error(`${field} 는 양의 정수여야 합니다: ${parsed.toString()}`);
  }
  return parsed;
}

/** IPv4/IPv6 문자만 허용한다. INET 캐스팅 전 1차 방어. */
function toSafeIp(value: string): string {
  if (!/^[0-9a-fA-F:.]{1,45}$/.test(value)) {
    throw new Error(`clientIp 형식이 올바르지 않습니다: ${value}`);
  }
  return value;
}

/**
 * 테넌트 컨텍스트를 주입한 트랜잭션을 실행한다.
 *
 * NTMS 의 모든 DB 접근은 이 함수를 통과해야 한다.
 * RLS 정책이 app.tenant_id 를 기준으로 행을 필터링하므로,
 * 컨텍스트 없이 접근하면 아무 행도 보이지 않는다(안전한 기본값).
 *
 * SET LOCAL 은 트랜잭션 종료와 함께 자동 해제된다.
 * SET(LOCAL 없이)을 쓰면 커넥션 풀에서 다음 요청으로 값이 새어
 * 다른 테넌트의 데이터가 노출되므로 절대 금지한다.
 *
 * @example
 * const orders = await withTenant(prisma, ctx, (tx) =>
 *   tx.transportOrder.findMany({ where: { status: 'RECEIVED' } })
 * );
 */
export async function withTenant<T>(
  prisma: PrismaClient,
  ctx: TenantContext,
  fn: (tx: TxClient) => Promise<T>,
  options?: { timeout?: number; maxWait?: number },
): Promise<T> {
  const tenantId = toSafeBigInt(ctx.tenantId, 'tenantId');
  const userId = toSafeBigInt(ctx.userId, 'userId');
  const clientIp = ctx.clientIp ? toSafeIp(ctx.clientIp) : undefined;

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId}'`);
      await tx.$executeRawUnsafe(`SET LOCAL app.user_id = '${userId}'`);
      if (clientIp) {
        await tx.$executeRawUnsafe(`SET LOCAL app.client_ip = '${clientIp}'`);
      }
      return fn(tx);
    },
    {
      timeout: options?.timeout ?? 15_000,
      maxWait: options?.maxWait ?? 5_000,
    },
  );
}

/**
 * 테넌트 컨텍스트 없이 실행한다. (로그인 · 테넌트 조회 · 배치 전용)
 *
 * RLS 를 우회하려면 접속 역할이 ntms_admin 이어야 한다.
 * 일반 요청 경로에서 이 함수를 쓰면 테넌트 격리가 무너지므로,
 * 호출 지점은 코드리뷰에서 반드시 확인할 것.
 */
export async function withoutTenant<T>(
  prisma: PrismaClient,
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(fn);
}

/** 채번 함수 호출 (ntms.fn_next_no) */
export async function nextNo(
  tx: TxClient,
  tenantId: bigint,
  ruleCode: string,
): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ no: string }>>`
    SELECT ntms.fn_next_no(${tenantId}::BIGINT, ${ruleCode}::VARCHAR) AS no
  `;
  const no = rows[0]?.no;
  if (!no) {
    throw new Error(`채번 실패: rule_code=${ruleCode}`);
  }
  return no;
}
