import { Module } from '@nestjs/common';
import { NaverModule } from '../naver/naver.module.js';
import { ExecutionController } from './execution.controller.js';
import { ExecutionService } from './execution.service.js';

@Module({
  // 트래킹이 도로 경로를 받아야 하므로 지도 창구를 함께 쓴다
  imports: [NaverModule],
  controllers: [ExecutionController],
  providers: [ExecutionService],
})
export class ExecutionModule {}
