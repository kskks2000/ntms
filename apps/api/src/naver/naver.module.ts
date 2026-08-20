import { Module } from '@nestjs/common';
import { NaverController } from './naver.controller.js';
import { NaverService } from './naver.service.js';

@Module({
  controllers: [NaverController],
  providers: [NaverService],
  exports: [NaverService],
})
export class NaverModule {}
