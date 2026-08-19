import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { MasterService, type MasterQuery } from './master.service.js';

/**
 * 기준정보 목록.
 *
 * 화면은 여덟이지만 창구는 여섯이다. 화주 · 운송사 · 거래처가 모두
 * business_partner 한 테이블이라, 역할 필터만 달리해 같은 창구를 쓴다.
 * 테이블이 하나인데 API 를 셋으로 늘리면 조건이 어긋나기 시작한다.
 */
const masterQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
  keyword: z.string().trim().max(100).optional(),
  filter: z.string().trim().max(40).optional(),
});

@Controller('master')
export class MasterController {
  constructor(private readonly master: MasterService) {}

  @Get('partners')
  partners(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(masterQuerySchema)) q: MasterQuery,
  ) {
    return this.master.partners(user, q);
  }

  @Get('vehicles')
  vehicles(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(masterQuerySchema)) q: MasterQuery,
  ) {
    return this.master.vehicles(user, q);
  }

  @Get('drivers')
  drivers(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(masterQuerySchema)) q: MasterQuery,
  ) {
    return this.master.drivers(user, q);
  }

  @Get('locations')
  locations(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(masterQuerySchema)) q: MasterQuery,
  ) {
    return this.master.locations(user, q);
  }

  @Get('routes')
  routes(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(masterQuerySchema)) q: MasterQuery,
  ) {
    return this.master.routes(user, q);
  }

  @Get('tariffs')
  tariffs(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(masterQuerySchema)) q: MasterQuery,
  ) {
    return this.master.tariffs(user, q);
  }
}
