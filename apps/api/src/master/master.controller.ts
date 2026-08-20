import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { Query } from '@nestjs/common';
import { z } from 'zod';
import {
  driverFormSchema,
  locationFormSchema,
  partnerFormSchema,
  routeFormSchema,
  rateDetailBulkSchema,
  tariffFormSchema,
  vehicleFormSchema,
  zoneFormSchema,
} from '@ntms/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { MasterService, type MasterQuery } from './master.service.js';
import { MasterWriteService } from './master-write.service.js';

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
  constructor(
    private readonly master: MasterService,
    private readonly write: MasterWriteService,
  ) {}

  /**
   * 폼이 쓰는 참조 목록.
   *
   * 목록 경로보다 위에 둔다 — `:id` 를 받는 경로가 먼저 걸리면
   * `/master/options` 가 id 로 해석된다.
   */
  @Get('options')
  options(@CurrentUser() user: AuthPrincipal) {
    return this.write.options(user);
  }

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

  // -------------------------------------------------------------------
  // 등록 · 수정
  //
  // 경로를 자원별로 넷씩(상세 · 등록 · 수정 · 삭제) 둔다. 하나의 저장 창구에
  // 자원 이름을 인자로 넘기는 방식이 짧아 보이지만, 그러면 본문 스키마를
  // 런타임에 골라야 해서 타입이 끊긴다.
  //
  // 삭제는 자원마다 "무엇이 이걸 쓰고 있나" 를 세는 목록이 전부 다르다.
  // 그것까지 한 창구로 묶으면 조건문 덩어리가 된다.
  // -------------------------------------------------------------------

  @Get('partners/:id')
  partnerDetail(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.write.partnerDetail(user, id);
  }

  @Post('partners')
  createPartner(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(partnerFormSchema)) dto: PartnerBody,
  ) {
    return this.write.savePartner(user, null, dto);
  }

  @Patch('partners/:id')
  updatePartner(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(partnerFormSchema)) dto: PartnerBody,
  ) {
    return this.write.savePartner(user, id, dto);
  }

  @Delete('partners/:id')
  deletePartner(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.write.deletePartner(user, id);
  }

  @Get('vehicles/:id')
  vehicleDetail(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.write.vehicleDetail(user, id);
  }

  @Post('vehicles')
  createVehicle(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(vehicleFormSchema)) dto: VehicleBody,
  ) {
    return this.write.saveVehicle(user, null, dto);
  }

  @Patch('vehicles/:id')
  updateVehicle(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(vehicleFormSchema)) dto: VehicleBody,
  ) {
    return this.write.saveVehicle(user, id, dto);
  }

  @Delete('vehicles/:id')
  deleteVehicle(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.write.deleteVehicle(user, id);
  }

  @Get('drivers/:id')
  driverDetail(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.write.driverDetail(user, id);
  }

  @Post('drivers')
  createDriver(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(driverFormSchema)) dto: DriverBody,
  ) {
    return this.write.saveDriver(user, null, dto);
  }

  @Patch('drivers/:id')
  updateDriver(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(driverFormSchema)) dto: DriverBody,
  ) {
    return this.write.saveDriver(user, id, dto);
  }

  @Delete('drivers/:id')
  deleteDriver(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.write.deleteDriver(user, id);
  }

  @Get('locations/:id')
  locationDetail(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.write.locationDetail(user, id);
  }

  @Post('locations')
  createLocation(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(locationFormSchema)) dto: LocationBody,
  ) {
    return this.write.saveLocation(user, null, dto);
  }

  @Patch('locations/:id')
  updateLocation(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(locationFormSchema)) dto: LocationBody,
  ) {
    return this.write.saveLocation(user, id, dto);
  }

  @Delete('locations/:id')
  deleteLocation(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.write.deleteLocation(user, id);
  }

  @Get('zones/:id')
  zoneDetail(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.write.zoneDetail(user, id);
  }

  @Post('zones')
  createZone(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(zoneFormSchema)) dto: ZoneBody,
  ) {
    return this.write.saveZone(user, null, dto);
  }

  @Patch('zones/:id')
  updateZone(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zoneFormSchema)) dto: ZoneBody,
  ) {
    return this.write.saveZone(user, id, dto);
  }

  @Delete('zones/:id')
  deleteZone(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.write.deleteZone(user, id);
  }

  @Get('routes/:id')
  routeDetail(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.write.routeDetail(user, id);
  }

  @Post('routes')
  createRoute(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(routeFormSchema)) dto: RouteBody,
  ) {
    return this.write.saveRoute(user, null, dto);
  }

  @Patch('routes/:id')
  updateRoute(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(routeFormSchema)) dto: RouteBody,
  ) {
    return this.write.saveRoute(user, id, dto);
  }

  @Delete('routes/:id')
  deleteRoute(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.write.deleteRoute(user, id);
  }

  @Get('tariffs/:id')
  tariffDetail(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.write.tariffDetail(user, id);
  }

  @Post('tariffs')
  createTariff(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(tariffFormSchema)) dto: TariffBody,
  ) {
    return this.write.saveTariff(user, null, dto);
  }

  @Patch('tariffs/:id')
  updateTariff(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(tariffFormSchema)) dto: TariffBody,
  ) {
    return this.write.saveTariff(user, id, dto);
  }

  @Delete('tariffs/:id')
  deleteTariff(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.write.deleteTariff(user, id);
  }

  // 요율 상세는 운임표에 딸린 것이라 경로도 그 아래에 둔다.
  // 저장은 줄 단위가 아니라 표 전체를 갈아 끼운다 — 이유는 서비스에 적어 두었다.

  @Get('tariffs/:id/rates')
  rateDetails(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.write.rateDetails(user, id);
  }

  @Put('tariffs/:id/rates')
  saveRateDetails(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rateDetailBulkSchema)) dto: RateBulkBody,
  ) {
    return this.write.saveRateDetails(user, id, dto);
  }
}

// 파이프를 통과한 뒤의 값 — 기본값과 변환이 이미 적용된 모양이다
type PartnerBody = z.output<typeof partnerFormSchema>;
type VehicleBody = z.output<typeof vehicleFormSchema>;
type DriverBody = z.output<typeof driverFormSchema>;
type LocationBody = z.output<typeof locationFormSchema>;
type ZoneBody = z.output<typeof zoneFormSchema>;
type RouteBody = z.output<typeof routeFormSchema>;
type TariffBody = z.output<typeof tariffFormSchema>;
type RateBulkBody = z.output<typeof rateDetailBulkSchema>;
