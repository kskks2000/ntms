import { Controller, Get, Query } from '@nestjs/common';
import type { DashboardOverview } from '@ntms/shared';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { DashboardService } from './dashboard.service.js';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /**
   * 관제 현황.
   *
   * date 를 받는 이유는 어제 무슨 일이 있었는지 되짚는 일이 잦기 때문이다.
   * 형식이 틀리면 오늘로 떨어뜨린다 — 잘못된 날짜 하나로 화면 전체가
   * 오류가 되는 것보다 낫다.
   */
  @Get('overview')
  overview(
    @CurrentUser() user: AuthPrincipal,
    @Query('date') date?: string,
  ): Promise<DashboardOverview> {
    return this.dashboard.overview(user, date);
  }
}
