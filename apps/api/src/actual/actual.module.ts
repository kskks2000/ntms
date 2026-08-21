import { Module } from '@nestjs/common';
import { ActualController } from './actual.controller.js';
import { ActualService } from './actual.service.js';
import { ActualReportService } from './actual-report.service.js';

@Module({
  controllers: [ActualController],
  providers: [ActualService, ActualReportService],
  // 정산이 확정된 실적을 물고 가야 하므로 밖으로 연다
  exports: [ActualService, ActualReportService],
})
export class ActualModule {}
