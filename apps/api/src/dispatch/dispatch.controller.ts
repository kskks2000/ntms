import { Controller, Get, Query } from '@nestjs/common';
import type { DispatchBoard } from '@ntms/shared';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { DispatchService } from './dispatch.service.js';

@Controller('dispatch')
export class DispatchController {
  constructor(private readonly dispatch: DispatchService) {}

  /** 배차판 — 차량 × 시간으로 본 하루 */
  @Get('board')
  board(
    @CurrentUser() user: AuthPrincipal,
    @Query('date') date?: string,
  ): Promise<DispatchBoard> {
    return this.dispatch.board(user, date);
  }
}
