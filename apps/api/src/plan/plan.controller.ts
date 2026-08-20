import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  allocateSchema,
  dispatchAssignSchema,
  tripCreateSchema,
  tripUpdateSchema,
} from '@ntms/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { PlanService } from './plan.service.js';

const dateSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '날짜 형식이 올바르지 않습니다')
    .default(() => new Date().toISOString().slice(0, 10)),
});

const respondSchema = z.object({
  accept: z.coerce.boolean(),
  reason: z.string().trim().max(500).nullable().default(null),
});

const cancelSchema = z.object({
  reason: z.string().trim().min(1, '사유를 입력하세요').max(500),
});

/**
 * 운송계획 창구.
 *
 * 편성 · 배정 · 배차를 한 컨트롤러에 둔 이유는 셋이 한 줄기이기 때문이다.
 * 트립 하나가 만들어져 운송사에 붙고 차가 정해지는 과정에서 상태가 서로
 * 맞물려 움직인다 — 파일을 나누면 그 맞물림이 안 보인다.
 */
@Controller('plan')
export class PlanController {
  constructor(private readonly plan: PlanService) {}

  // --- 편성 ----------------------------------------------------------

  @Get('consolidation')
  consolidation(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(dateSchema)) q: { date: string },
  ) {
    return this.plan.consolidation(user, q.date);
  }

  @Post('trips')
  createTrip(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(tripCreateSchema)) dto: TripCreateBody,
  ) {
    return this.plan.createTrip(user, dto);
  }

  @Get('trips/:id')
  tripView(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.plan.tripView(user, id);
  }

  @Patch('trips/:id')
  updateTrip(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(tripUpdateSchema)) dto: TripUpdateBody,
  ) {
    return this.plan.updateTrip(user, id, dto);
  }

  @Post('trips/:id/confirm')
  confirmTrip(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.plan.confirmTrip(user, id);
  }

  /** 편성 해제 — 트립을 접고 오더를 풀로 돌려보낸다 */
  @Delete('trips/:id')
  deleteTrip(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.plan.deleteTrip(user, id);
  }

  // --- 배정 ----------------------------------------------------------

  @Get('allocations')
  allocations(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(dateSchema)) q: { date: string },
  ) {
    return this.plan.allocationPage(user, q.date);
  }

  @Get('trips/:id/candidates')
  candidates(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.plan.candidates(user, id);
  }

  @Post('trips/:id/allocate')
  allocate(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(allocateSchema)) dto: AllocateBody,
  ) {
    return this.plan.allocate(user, id, dto);
  }

  /**
   * 운송사의 답을 기록한다.
   *
   * 지금은 배차실이 전화로 받아 대신 찍는다. 나중에 운송사 포털이 붙으면
   * 같은 창구를 그쪽에서 부르면 된다 — 그래서 "수락 처리" 가 아니라
   * "답을 기록" 하는 모양으로 뒀다.
   */
  @Post('allocations/:id/respond')
  respond(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(respondSchema)) dto: { accept: boolean; reason: string | null },
  ) {
    return this.plan.respondAllocation(user, id, dto.accept, dto.reason);
  }

  @Post('allocations/:id/cancel')
  cancelAllocation(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelSchema)) dto: { reason: string },
  ) {
    return this.plan.cancelAllocation(user, id, dto.reason);
  }

  // --- 배차 ----------------------------------------------------------

  @Get('trips/:id/dispatch-candidates')
  dispatchCandidates(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.plan.dispatchCandidates(user, id);
  }

  @Post('trips/:id/dispatch')
  assignDispatch(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(dispatchAssignSchema)) dto: DispatchBody,
  ) {
    return this.plan.assignDispatch(user, id, dto);
  }
}

type TripCreateBody = z.output<typeof tripCreateSchema>;
type TripUpdateBody = z.output<typeof tripUpdateSchema>;
type AllocateBody = z.output<typeof allocateSchema>;
type DispatchBody = z.output<typeof dispatchAssignSchema>;
