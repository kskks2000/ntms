import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CurrentUser, Public } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { NaverService } from './naver.service.js';

const latLng = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});

const directionsSchema = z.object({
  start: latLng,
  goal: latLng,
  waypoints: z.array(latLng).max(5).default([]),
  option: z.enum(['trafast', 'tracomfort', 'traoptimal', 'traavoidtoll']).default('trafast'),
});

const geocodeSchema = z.object({
  query: z.string().trim().min(2, '주소를 2자 이상 입력하세요').max(200),
});

/**
 * 지도 창구.
 *
 * 브라우저는 지도 SDK 만 직접 부르고, 키가 필요한 것은 전부 여기를 거친다.
 * 지오코딩·경로탐색 키가 화면에 노출되면 남이 우리 요금을 쓴다.
 */
@Controller('naver')
export class NaverController {
  constructor(private readonly naver: NaverService) {}

  /**
   * 화면이 지도를 띄울 수 있는지.
   *
   * 로그인 전에도 필요할 수 있어 열어 둔다. 여기서 나가는 clientId 는
   * 원래 브라우저에 박히는 값이라 감출 대상이 아니다 — 대신 NCP 콘솔에서
   * 도메인을 묶어 다른 사이트가 못 쓰게 한다.
   */
  @Public()
  @Get('config')
  config() {
    return this.naver.config();
  }

  @Get('geocode')
  geocode(
    @CurrentUser() _user: AuthPrincipal,
    @Query(new ZodValidationPipe(geocodeSchema)) q: { query: string },
  ) {
    return this.naver.geocode(q.query);
  }

  @Post('directions')
  directions(
    @CurrentUser() _user: AuthPrincipal,
    @Body(new ZodValidationPipe(directionsSchema)) dto: DirectionsBody,
  ) {
    return this.naver.directions(dto);
  }
}

type DirectionsBody = z.output<typeof directionsSchema>;
