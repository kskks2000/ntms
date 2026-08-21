import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SystemController } from './system.controller.js';
import { AuditService } from './audit.service.js';
import { CodeService } from './code.service.js';
import { UserService } from './user.service.js';

/**
 * 시스템관리 — 사용자·권한 · 공통코드 · 감사로그.
 *
 * AuthModule 을 들이는 것은 `AuthConfig` 때문이다. 계정이 몇 번 틀리면
 * 잠기는지(`maxFailCount`)를 화면이 알아야 "2회 더 틀리면 잠깁니다" 를
 * 적을 수 있고, 그 숫자는 인증이 실제로 쓰는 값과 같아야 한다.
 */
@Module({
  imports: [AuthModule],
  controllers: [SystemController],
  providers: [UserService, CodeService, AuditService],
  exports: [AuditService],
})
export class SystemModule {}
