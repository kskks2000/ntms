import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Docker healthcheck 및 nginx 업스트림 판정용 */
  @Get()
  async check(): Promise<{ status: string; db: boolean; uptime: number }> {
    let db = false;
    try {
      db = await this.prisma.ping();
    } catch {
      db = false;
    }

    return {
      status: db ? 'ok' : 'degraded',
      db,
      uptime: Math.round(process.uptime()),
    };
  }
}
