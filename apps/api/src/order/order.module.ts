import { Module } from '@nestjs/common';
import { OrderController } from './order.controller.js';
import { OrderService } from './order.service.js';
import { OrderWriteService } from './order-write.service.js';

@Module({
  controllers: [OrderController],
  providers: [OrderService, OrderWriteService],
})
export class OrderModule {}
