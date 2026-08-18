import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    PrismaModule,
    HealthModule,
    // 도메인 모듈은 Phase 1 부터 여기에 추가한다
    // AuthModule, MasterModule, OrderModule, PlanModule,
    // ExecutionModule, ActualModule, SettlementModule
  ],
})
export class AppModule {}
