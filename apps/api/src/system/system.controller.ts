import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  AUDIT_ACTIONS,
  USER_STATUS,
  codeGroupUpsertSchema,
  codeReorderSchema,
  codeUpsertSchema,
  userActionSchema,
  userUpsertSchema,
  type CodeGroupUpsertValues,
  type CodeReorderInput,
  type CodeUpsertValues,
  type UserActionInput,
  type UserUpsertValues,
} from '@ntms/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AuditService, type AuditListQuery } from './audit.service.js';
import { CodeService } from './code.service.js';
import { UserService, type UserListQuery } from './user.service.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜 형식이 올바르지 않습니다');
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const bool = (dflt: 'true' | 'false' = 'false') =>
  z
    .enum(['true', 'false'])
    .default(dflt)
    .transform((v) => v === 'true');

const userListSchema = z.object({
  keyword: z.string().trim().max(60).default(''),
  status: z.enum(USER_STATUS).nullable().default(null),
  roleId: z.string().regex(/^\d+$/).nullable().default(null),
  privilegedOnly: bool(),
  blockedOnly: bool(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(10).max(200).default(20),
  sort: z
    .enum(['name:asc', 'name:desc', 'login:asc', 'reach:desc', 'reach:asc', 'lastLogin:desc'])
    .default('name:asc'),
});

const auditListSchema = z.object({
  // 파티션이 월 단위다. 기본을 7일로 두면 대개 한두 파티션만 읽는다.
  from: day.default(() => daysAgo(6)),
  to: day.default(today),
  scope: z.string().trim().max(30).default('ALL'),
  table: z.string().trim().max(100).nullable().default(null),
  action: z.enum(AUDIT_ACTIONS).nullable().default(null),
  changedBy: z.string().regex(/^\d+$/).nullable().default(null),
  recordPk: z.string().trim().max(100).nullable().default(null),
  byPersonOnly: bool(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(10).max(200).default(30),
});

const facetSchema = z.object({
  from: day.default(() => daysAgo(6)),
  to: day.default(today),
});

const trailSchema = z.object({
  table: z.string().trim().min(1).max(100),
  recordPk: z.string().trim().min(1).max(100),
});

const groupListSchema = z.object({ keyword: z.string().trim().max(60).default('') });

/**
 * 시스템관리 창구.
 *
 * **컨트롤러 전체가 ADMIN 전용이다.** 계정을 만들고 권한을 옮기고 감사
 * 기록을 읽는 일이라, 하나라도 새면 나머지 통제가 의미를 잃는다.
 * `@Roles` 는 `RolesGuard` 가 집행한다 — 가드가 없으면 이 줄은 주석이다.
 *
 * 세 도메인을 한 컨트롤러에 둔 것은 셋 다 같은 사람이 같은 자리에서 보는
 * 일이기 때문이다. 계정을 고치면 감사에 남고, 감사에서 이상한 변경을
 * 발견하면 계정으로 돌아간다.
 */
@Roles('ADMIN')
@Controller('system')
export class SystemController {
  constructor(
    private readonly users: UserService,
    private readonly codes: CodeService,
    private readonly audit: AuditService,
  ) {}

  // --- 사용자 · 권한 -------------------------------------------------

  // 구체 경로를 먼저. :id 가 위에 있으면 'roles' 를 id 로 먹는다.
  @Get('roles')
  roleList(@CurrentUser() user: AuthPrincipal) {
    return this.users.roles(user);
  }

  @Get('users')
  userList(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(userListSchema)) q: UserListQuery,
  ) {
    return this.users.list(user, q);
  }

  @Get('users/:id')
  userDetail(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.users.detail(user, id);
  }

  @Patch('users/:id')
  userUpdate(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(userUpsertSchema)) body: UserUpsertValues,
  ) {
    return this.users.update(user, id, body);
  }

  @Post('users/:id/unlock')
  userUnlock(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(userActionSchema)) body: UserActionInput,
  ) {
    return this.users.unlock(user, id, body);
  }

  @Post('users/:id/deactivate')
  userDeactivate(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(userActionSchema)) body: UserActionInput,
  ) {
    return this.users.deactivate(user, id, body);
  }

  // --- 공통코드 -------------------------------------------------------

  @Get('code-groups')
  groupList(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(groupListSchema)) q: { keyword: string },
  ) {
    return this.codes.groups(user, q.keyword);
  }

  @Post('code-groups')
  groupCreate(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(codeGroupUpsertSchema)) body: CodeGroupUpsertValues,
  ) {
    return this.codes.createGroup(user, body);
  }

  @Get('code-groups/:groupId')
  groupDetail(@CurrentUser() user: AuthPrincipal, @Param('groupId') groupId: string) {
    return this.codes.detail(user, groupId);
  }

  @Patch('code-groups/:groupId')
  groupUpdate(
    @CurrentUser() user: AuthPrincipal,
    @Param('groupId') groupId: string,
    @Body(new ZodValidationPipe(codeGroupUpsertSchema)) body: CodeGroupUpsertValues,
  ) {
    return this.codes.updateGroup(user, groupId, body);
  }

  @Post('code-groups/:groupId/codes')
  codeCreate(
    @CurrentUser() user: AuthPrincipal,
    @Param('groupId') groupId: string,
    @Body(new ZodValidationPipe(codeUpsertSchema)) body: CodeUpsertValues,
  ) {
    return this.codes.createCode(user, groupId, body);
  }

  @Post('code-groups/:groupId/reorder')
  codeReorder(
    @CurrentUser() user: AuthPrincipal,
    @Param('groupId') groupId: string,
    @Body(new ZodValidationPipe(codeReorderSchema)) body: CodeReorderInput,
  ) {
    return this.codes.reorder(user, groupId, body);
  }

  @Patch('code-groups/:groupId/codes/:codeId')
  codeUpdate(
    @CurrentUser() user: AuthPrincipal,
    @Param('groupId') groupId: string,
    @Param('codeId') codeId: string,
    @Body(new ZodValidationPipe(codeUpsertSchema)) body: CodeUpsertValues,
  ) {
    return this.codes.updateCode(user, groupId, codeId, body);
  }

  @Delete('code-groups/:groupId/codes/:codeId')
  codeRemove(
    @CurrentUser() user: AuthPrincipal,
    @Param('groupId') groupId: string,
    @Param('codeId') codeId: string,
  ) {
    return this.codes.removeCode(user, groupId, codeId);
  }

  // --- 감사로그 -------------------------------------------------------

  @Get('audit/facets')
  auditFacets(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(facetSchema)) q: { from: string; to: string },
  ) {
    return this.audit.facets(user, q.from, q.to);
  }

  @Get('audit/trail')
  auditTrail(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(trailSchema)) q: { table: string; recordPk: string },
  ) {
    return this.audit.trail(user, q.table, q.recordPk);
  }

  @Get('audit')
  auditList(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(auditListSchema)) q: AuditListQuery,
  ) {
    return this.audit.list(user, q);
  }

  @Get('audit/:id')
  auditDetail(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.audit.detail(user, id);
  }
}
