import { PrismaClient } from '@prisma/client';

const isProd = process.env.NODE_ENV === 'production';

/**
 * PrismaClient 싱글턴.
 *
 * 개발 모드에서 HMR 이 모듈을 다시 평가할 때마다 새 클라이언트를 만들면
 * 커넥션이 누적되어 max_connections 를 금방 소진한다. globalThis 에 캐시한다.
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: isProd
      ? [{ emit: 'event', level: 'error' }]
      : [
          { emit: 'event', level: 'error' },
          { emit: 'event', level: 'warn' },
          { emit: 'stdout', level: 'query' },
        ],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (!isProd) {
  globalForPrisma.prisma = prisma;
}

export { PrismaClient };
export type { Prisma } from '@prisma/client';
