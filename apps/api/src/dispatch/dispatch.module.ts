import { Module } from '@nestjs/common';
import { DispatchController } from './dispatch.controller.js';
import { DispatchService } from './dispatch.service.js';

@Module({
  controllers: [DispatchController],
  providers: [DispatchService],
})
export class DispatchModule {}
