import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  orderFormSchema,
  orderListQuerySchema,
  type OrderListItem,
  type OrderListQuery,
  type OrderListSummary,
  type PageResult,
} from '@ntms/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { OrderService } from './order.service.js';
import { OrderWriteService } from './order-write.service.js';

const cancelSchema = z.object({
  reason: z.string().trim().min(1, '취소 사유를 입력하세요').max(500),
});

@Controller('orders')
export class OrderController {
  constructor(
    private readonly orders: OrderService,
    private readonly write: OrderWriteService,
  ) {}

  /**
   * 오더 폼이 쓰는 차종 목록 — 적재 한계까지 함께.
   *
   * `:id` 를 받는 경로보다 위에 둔다. 아래에 두면 `capacities` 가 오더
   * id 로 해석된다.
   */
  @Get('vehicle-capacities')
  vehicleCapacities(@CurrentUser() user: AuthPrincipal) {
    return this.write.vehicleCapacities(user);
  }

  /** 두 거점 사이의 거리·소요시간. 시간 축이 이 값으로 판정한다 */
  @Get('route')
  route(
    @CurrentUser() user: AuthPrincipal,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.write.route(user, from ?? null, to ?? null);
  }

  /**
   * 오더 목록.
   *
   * 합계(summary)를 함께 내리는 이유는, 배차 담당자가 화면에서 가장 자주
   * 하는 질문이 "이 조건으로 몇 건 · 몇 톤인가" 이기 때문이다. 페이지에
   * 보이는 20건만 더해서는 답이 되지 않는다.
   */
  @Get()
  list(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(orderListQuerySchema)) query: OrderListQuery,
  ): Promise<PageResult<OrderListItem> & { summary: OrderListSummary }> {
    return this.orders.list(user, query);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.write.detail(user, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(orderFormSchema)) dto: OrderBody,
  ) {
    return this.write.save(user, null, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(orderFormSchema)) dto: OrderBody,
  ) {
    return this.write.save(user, id, dto);
  }

  /**
   * 취소는 삭제가 아니다.
   *
   * 오더는 화주와 주고받은 기록이라, 지우면 "그때 그 건은 어떻게 됐나" 에
   * 답할 수 없다. 상태를 CANCELLED 로 바꾸고 사유를 이력에 남긴다.
   */
  @Post(':id/cancel')
  cancel(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelSchema)) dto: { reason: string },
  ) {
    return this.write.cancel(user, id, dto.reason);
  }
}

type OrderBody = z.output<typeof orderFormSchema>;
