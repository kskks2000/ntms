import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  PrismaClient,
  createPrismaClient,
  withTenant,
  withoutTenant,
  type TenantContext,
  type TxClient,
} from '@ntms/db';

/**
 * Prisma 접근 서비스.
 *
 * 컨트롤러/서비스는 이 클래스의 run() 만 사용한다.
 * client 를 직접 노출하지 않는 이유는 테넌트 컨텍스트 없는 쿼리를
 * 실수로 실행하는 것을 막기 위해서다.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly client: PrismaClient = createPrismaClient();

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  /**
   * 테넌트 컨텍스트를 주입한 트랜잭션.
   * 모든 업무 쿼리는 이 경로로만 실행한다.
   */
  run<T>(ctx: TenantContext, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return withTenant(this.client, ctx, fn);
  }

  /**
   * 컨텍스트 없는 트랜잭션. 로그인·테넌트 조회·전역 배치 전용.
   *
   * RLS 를 우회하려면 접속 역할이 ntms_admin 이어야 한다.
   * 일반 요청 경로에서 호출하면 테넌트 격리가 무너진다 — 코드리뷰 필수 확인 지점.
   */
  runSystem<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return withoutTenant(this.client, fn);
  }

  /** 헬스체크 전용 */
  async ping(): Promise<boolean> {
    await this.client.$queryRaw`SELECT 1`;
    return true;
  }
}
