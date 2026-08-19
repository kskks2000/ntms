import { Controller, Get, Query } from '@nestjs/common';
import {
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

@Controller('orders')
export class OrderController {
  constructor(private readonly orders: OrderService) {}

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
}
