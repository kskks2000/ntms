import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { DispatchModule } from './dispatch/dispatch.module.js';
import { MasterModule } from './master/master.module.js';
import { OrderModule } from './order/order.module.js';
import { PlanModule } from './plan/plan.module.js';
import { ExecutionModule } from './execution/execution.module.js';
import { ActualModule } from './actual/actual.module.js';
import { NaverModule } from './naver/naver.module.js';
import { SystemModule } from './system/system.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';

@Module({
  imports: [
    // .env 는 저장소 루트 한 곳에만 둔다(turbo.json 의 globalDependencies 도 그것을
    // 본다). API 의 cwd 는 apps/api 이므로 두 단계 위를 함께 가리킨다.
    // 도커에서는 파일 없이 compose environment 로 들어오며, 없는 경로는 무시된다.
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env', '../../.env'],
    }),
    // 기본 한도. 인증 라우트는 @Throttle() 로 각자 더 조인다.
    // IP 기준이므로 nginx 뒤에서는 trust proxy 설정이 맞아야 의미가 있다.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    PrismaModule,
    HealthModule,
    AuthModule,
    DashboardModule,
    DispatchModule,
    MasterModule,
    OrderModule,
    PlanModule,
    ExecutionModule,
    ActualModule,
    NaverModule,
    SystemModule,
    // 남은 도메인 모듈: SettlementModule
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
