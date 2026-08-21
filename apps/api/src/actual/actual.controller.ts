import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  actualConfirmSchema,
  actualGenerateSchema,
  actualHoldSchema,
  actualReopenSchema,
  actualReviewSchema,
  type ActualConfirmInput,
  type ActualGenerateInput,
  type ActualHoldInput,
  type ActualReopenInput,
  type ActualReviewInput,
} from '@ntms/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { ActualService, type ActualListQuery } from './actual.service.js';
import { ActualReportService } from './actual-report.service.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜 형식이 올바르지 않습니다');
const today = () => new Date().toISOString().slice(0, 10);
const weekAgo = () => new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);

/**
 * 정렬 키는 **허용 목록**으로 받는다.
 *
 * 쿼리 문자열을 그대로 orderBy 에 넘기면 스키마가 그대로 노출되고, 인덱스가
 * 없는 칸으로 정렬을 시켜 표를 통째로 훑게 만들 수도 있다.
 */
const listSchema = z.object({
  from: day.default(weekAgo),
  to: day.default(today),
  // 'OPEN' 은 손이 필요한 상태 셋을 한 번에 고른다. 검수자가 가장 자주 쓰는
  // 조건이라 상태를 세 번 찍게 하지 않는다.
  status: z
    .enum(['OPEN', 'DRAFT', 'REVIEWING', 'CONFIRMED', 'CLOSED', 'REOPENED'])
    .nullable()
    .default(null),
  carrierId: z.string().regex(/^\d+$/).nullable().default(null),
  keyword: z.string().trim().max(60).default(''),
  blockedOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(10).max(200).default(20),
  sort: z
    .enum(['date:desc', 'date:asc', 'variance:desc', 'variance:asc', 'billing:desc', 'distance:desc'])
    .default('date:desc'),
});

const dailySchema = z.object({ date: day.default(today) });

const kpiSchema = z.object({
  from: day.default(() => new Date(Date.now() - 13 * 86_400_000).toISOString().slice(0, 10)),
  to: day.default(today),
});

const rebuildSchema = z.object({ from: day, to: day });

/**
 * 실적 창구.
 *
 * 목록 · 상세 · 확정이 한 컨트롤러에 있고, 운행일보와 KPI 도 같이 있다.
 * 셋 다 같은 `transport_actual` 을 각도만 달리해 보기 때문이다 — 건별로
 * 보면 실적, 차량별로 접으면 운행일보, 날짜별로 접으면 KPI 다.
 */
@Controller('actuals')
export class ActualController {
  constructor(
    private readonly actual: ActualService,
    private readonly report: ActualReportService,
  ) {}

  // 구체 경로를 먼저 둔다. :id 가 위에 있으면 'daily' 를 id 로 먹는다.

  @Get('daily')
  daily(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(dailySchema)) q: { date: string },
  ) {
    return this.report.daily(user, q.date);
  }

  @Get('kpi')
  kpi(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(kpiSchema)) q: { from: string; to: string },
  ) {
    return this.report.kpi(user, q.from, q.to);
  }

  /**
   * 집계를 다시 찍는다.
   *
   * 실적을 확정하면 자동으로 도는 일이지만, 시드로 데이터를 밀어 넣었거나
   * 배치가 실패했을 때 손으로 돌릴 창구가 있어야 한다.
   */
  @Post('rebuild')
  rebuild(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(rebuildSchema)) dto: { from: string; to: string },
  ) {
    const dates: string[] = [];
    for (
      let t = Date.parse(`${dto.from}T00:00:00Z`);
      t <= Date.parse(`${dto.to}T00:00:00Z`);
      t += 86_400_000
    ) {
      dates.push(new Date(t).toISOString().slice(0, 10));
    }
    return this.report.rebuild(user, dates);
  }

  @Post('generate')
  generate(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(actualGenerateSchema)) dto: ActualGenerateInput,
  ) {
    return this.actual.generate(user, dto.from, dto.to);
  }

  @Post('confirm')
  confirm(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(actualConfirmSchema)) dto: ActualConfirmInput,
  ) {
    return this.actual.confirm(user, dto.actualIds);
  }

  @Get()
  list(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(listSchema)) q: ActualListQuery,
  ) {
    return this.actual.list(user, q);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.actual.detail(user, id);
  }

  @Patch(':id')
  review(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(actualReviewSchema)) dto: ActualReviewInput,
  ) {
    return this.actual.review(user, id, dto);
  }

  @Post(':id/hold')
  hold(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(actualHoldSchema)) dto: ActualHoldInput,
  ) {
    return this.actual.hold(user, id, dto.reason);
  }

  @Post(':id/reopen')
  reopen(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(actualReopenSchema)) dto: ActualReopenInput,
  ) {
    return this.actual.reopen(user, id, dto.reason);
  }
}
