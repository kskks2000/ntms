import { Module } from '@nestjs/common';
import { MasterController } from './master.controller.js';
import { MasterService } from './master.service.js';
import { MasterWriteService } from './master-write.service.js';

@Module({
  controllers: [MasterController],
  providers: [MasterService, MasterWriteService],
})
export class MasterModule {}
