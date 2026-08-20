import { Module } from '@nestjs/common';
import { PlanController } from './plan.controller.js';
import { PlanService } from './plan.service.js';

@Module({
  controllers: [PlanController],
  providers: [PlanService],
})
export class PlanModule {}
