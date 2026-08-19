import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/auth.decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Docker healthcheck 및 nginx 업스트림 판정용.
   * 인증 가드가 전역이라 명시적으로 열어야 한다 — 잠기면 컨테이너가
   * unhealthy 로 떨어지고 배포가 멈춘다.
   */
  @Public()
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
