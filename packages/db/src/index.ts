export { prisma, createPrismaClient, PrismaClient } from './client.js';
export type { Prisma } from './client.js';
export {
  withTenant,
  withTenantBootstrap,
  withoutTenant,
  nextNo,
} from './tenant-context.js';
export type { TenantContext, TxClient } from './tenant-context.js';
