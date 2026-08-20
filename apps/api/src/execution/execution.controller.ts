import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  exceptionCreateSchema,
  exceptionUpdateSchema,
  podConfirmSchema,
  type ExceptionCreateInput,
  type ExceptionUpdateInput,
  type PodConfirmInput,
} from '@ntms/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { ExecutionService } from './execution.service.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜 형식이 올바르지 않습니다');
const today = () => new Date().toISOString().slice(0, 10);

const boardSchema = z.object({ date: day.default(today) });

const lookupSchema = z.object({
  q: z.string().trim().max(60).default(''),
});

const exceptionQuerySchema = z.object({
  from: day.default(today),
  to: day.default(today),
  // 'OPEN' 은 아직 손이 필요한 상태 셋을 한 번에 고른다. 관제가 가장
  // 자주 쓰는 조건이라 상태를 세 개 찍게 하지 않는다.
  status: z
    .enum(['OPEN', 'REPORTED', 'INVESTIGATING', 'ACTION_TAKEN', 'RESOLVED', 'CLOSED'])
    .nullable()
    .default('OPEN'),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).nullable().default(null),
});

const podQuerySchema = z.object({
  from: day.default(today),
  to: day.default(today),
  result: z
    .enum(['NORMAL', 'PARTIAL', 'DAMAGED', 'SHORTAGE', 'REFUSED', 'ABSENT', 'MISDELIVERY'])
    .nullable()
    .default(null),
  confirmed: z.enum(['Y', 'N']).nullable().default(null),
});

/**
 * 운송실행 창구.
 *
 * 관제 · 예외 · 인수증이 한 컨트롤러에 있다. 셋 다 "실제로 무슨 일이
 * 있었나" 를 묻는 화면이고, 같은 실행 건을 각도만 달리해 본다.
 */
@Controller('execution')
export class ExecutionController {
  constructor(private readonly execution: ExecutionService) {}

  // 구체 경로를 먼저 둔다. :id 가 위에 있으면 'exceptions' 를 id 로 먹는다.

  @Get('lookup')
  lookup(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(lookupSchema)) q: { q: string },
  ) {
    return this.execution.lookup(user, q.q);
  }

  @Get('exceptions')
  exceptions(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(exceptionQuerySchema)) q: ExceptionQuery,
  ) {
    return this.execution.exceptions(user, q);
  }

  @Post('exceptions')
  createException(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(exceptionCreateSchema)) dto: ExceptionCreateInput,
  ) {
    return this.execution.createException(user, dto);
  }

  @Patch('exceptions/:id')
  updateException(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(exceptionUpdateSchema)) dto: ExceptionUpdateInput,
  ) {
    return this.execution.updateException(user, id, dto);
  }

  @Get('pods')
  pods(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(podQuerySchema)) q: PodQuery,
  ) {
    return this.execution.pods(user, q);
  }

  @Patch('pods/:id/confirm')
  confirmPod(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(podConfirmSchema)) dto: PodConfirmInput,
  ) {
    return this.execution.confirmPod(user, id, dto);
  }

  @Get('board')
  board(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(boardSchema)) q: { date: string },
  ) {
    return this.execution.board(user, q.date);
  }

  @Get(':id/track')
  track(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.execution.track(user, id);
  }
}

type ExceptionQuery = {
  from: string;
  to: string;
  status: string | null;
  severity: string | null;
};

type PodQuery = {
  from: string;
  to: string;
  result: string | null;
  confirmed: string | null;
};
