import { Injectable } from '@nestjs/common';
import type { TxClient } from '@ntms/db';
import {
  buildCodePreview,
  type CodeGroupDetail,
  type CodeGroupItem,
  type CodeGroupUpsertValues,
  type CodeItem,
  type CodeReorderInput,
  type CodeUpsertValues,
} from '@ntms/shared';
import { AppError } from '../common/api-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toTenantContext, type AuthPrincipal } from '../auth/auth.types.js';

/**
 * 공통코드.
 *
 * ## 이 화면의 결과물은 표가 아니라 다른 화면의 드롭다운이다
 *
 * 관리자가 여기서 하는 일 — 코드를 끄고, 순서를 바꾸고, 이름을 고치는 것 —
 * 은 전부 **다른 화면의 선택 목록**으로 나타난다. 그런데 보통의 코드 관리
 * 화면은 표만 보여 주므로, 관리자는 자기가 무엇을 바꿨는지 확인하려고
 * 다른 화면을 열어 봐야 한다.
 *
 * 그래서 응답에 `preview` 를 함께 실어 보낸다. 끈 코드는 미리보기에서
 * 사라지고, 순서를 바꾸면 미리보기 순서가 바뀐다. 판정은
 * `buildCodePreview()` 한 벌이고, 실제 드롭다운을 그리는 화면도 같은 것을
 * 부른다 — 미리보기가 진짜와 다르면 미리보기가 아니라 거짓말이다.
 *
 * ## 전 테넌트 공용 그룹
 *
 * `code_group.tenant_id` 가 NULL 이면 모든 테넌트가 같이 쓴다. RLS 정책이
 * 그런 행을 읽기는 허용하지만, **고치는 것은 막는다.** 한 회사가 고친 것이
 * 다른 회사 화면을 바꾸면 안 된다.
 */
@Injectable()
export class CodeService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------
  // 조회
  // -------------------------------------------------------------------

  async groups(user: AuthPrincipal, keyword: string): Promise<CodeGroupItem[]> {
    return this.prisma.run(toTenantContext(user), async (tx) => {
      const where: Record<string, unknown> = {};
      if (keyword) {
        where.OR = [
          { group_code: { contains: keyword, mode: 'insensitive' } },
          { group_name: { contains: keyword, mode: 'insensitive' } },
        ];
      }

      const rows = await tx.code_group.findMany({
        where,
        select: GROUP_SELECT,
        orderBy: [{ sort_order: 'asc' }, { group_code: 'asc' }],
      });
      return rows.map(toGroupItem);
    });
  }

  async detail(user: AuthPrincipal, groupId: string): Promise<CodeGroupDetail> {
    return this.prisma.run(toTenantContext(user), (tx) => this.readDetail(tx, groupId));
  }

  private async readDetail(tx: TxClient, groupId: string): Promise<CodeGroupDetail> {
    const row = await tx.code_group.findFirst({
      where: { code_group_id: BigInt(groupId) },
      select: GROUP_SELECT,
    });
    if (!row) throw AppError.notFound('CODE_GROUP_NOT_FOUND', '없는 코드 그룹입니다.');

    const codes = await tx.code.findMany({
      where: { code_group_id: row.code_group_id },
      select: {
        code_id: true,
        code_value: true,
        code_name: true,
        code_name_en: true,
        parent_code_id: true,
        sort_order: true,
        attr1: true,
        attr2: true,
        attr3: true,
        description: true,
        is_active: true,
      },
      orderBy: [{ sort_order: 'asc' }, { code_value: 'asc' }],
    });

    // 계층형 코드는 부모를 code_id 로 물고 있다. 화면은 코드값으로 읽으므로
    // 여기서 한 번 뒤집어 준다 — 화면이 id 를 다시 찾아 다니게 하지 않는다.
    const valueById = new Map(codes.map((c) => [String(c.code_id), c.code_value]));

    const items: CodeItem[] = codes.map((c) => ({
      codeId: String(c.code_id),
      codeValue: c.code_value,
      codeName: c.code_name,
      codeNameEn: c.code_name_en,
      parentCodeId: c.parent_code_id ? String(c.parent_code_id) : null,
      parentCodeValue: c.parent_code_id
        ? (valueById.get(String(c.parent_code_id)) ?? null)
        : null,
      sortOrder: c.sort_order,
      attr1: c.attr1,
      attr2: c.attr2,
      attr3: c.attr3,
      description: c.description,
      isActive: c.is_active,
    }));

    return {
      ...toGroupItem(row),
      codes: items,
      preview: buildCodePreview(items),
    };
  }

  // -------------------------------------------------------------------
  // 쓰기
  // -------------------------------------------------------------------

  /**
   * 고쳐도 되는 그룹인지 본다.
   *
   * 두 가지를 막는다 — 전 테넌트 공용(`tenant_id` NULL)과 시스템 코드
   * (`is_system`). 시스템 코드는 앱이 코드값을 하드코딩해 쓰는 것들이라
   * 값이 바뀌면 코드가 못 찾는다. 이름과 순서는 열어 두고 **코드값만**
   * 잠그는 방법도 있지만, 그러면 "일부만 고칠 수 있는 표" 라는 설명하기
   * 어려운 상태가 되므로 그룹 통째로 잠근다.
   */
  private async guardWritable(tx: TxClient, groupId: bigint, tenantId: bigint) {
    const group = await tx.code_group.findFirst({
      where: { code_group_id: groupId },
      select: { code_group_id: true, tenant_id: true, is_system: true, group_name: true },
    });
    if (!group) throw AppError.notFound('CODE_GROUP_NOT_FOUND', '없는 코드 그룹입니다.');
    if (group.tenant_id === null)
      throw AppError.forbidden(
        'SHARED_CODE_GROUP',
        '모든 회사가 같이 쓰는 코드라 여기서는 고칠 수 없습니다.',
      );
    if (group.tenant_id !== tenantId)
      throw AppError.notFound('CODE_GROUP_NOT_FOUND', '없는 코드 그룹입니다.');
    if (group.is_system)
      throw AppError.forbidden(
        'SYSTEM_CODE_GROUP',
        `'${group.group_name}' 은 시스템이 값을 직접 참조하는 코드입니다. 값이 바뀌면 화면이 코드를 못 찾습니다.`,
      );
    return group;
  }

  async createGroup(
    user: AuthPrincipal,
    input: CodeGroupUpsertValues,
  ): Promise<CodeGroupDetail> {
    const id = await this.prisma.run(toTenantContext(user), async (tx) => {
      // nullable BigInt 은 `in: [값, null]` 을 못 받는다. 공용 그룹(NULL)과
      // 이름이 겹치는 것도 막아야 하므로 OR 로 푼다.
      const dup = await tx.code_group.findFirst({
        where: {
          group_code: input.groupCode,
          OR: [{ tenant_id: user.tenantId }, { tenant_id: null }],
        },
        select: { code_group_id: true },
      });
      if (dup)
        throw AppError.conflict('GROUP_CODE_TAKEN', '이미 쓰고 있는 그룹코드입니다.');

      const created = await tx.code_group.create({
        data: {
          tenant_id: user.tenantId,
          group_code: input.groupCode,
          group_name: input.groupName,
          description: input.description || null,
          sort_order: input.sortOrder,
          is_active: input.isActive,
          is_system: false,
        },
        select: { code_group_id: true },
      });
      return String(created.code_group_id);
    });
    return this.detail(user, id);
  }

  async updateGroup(
    user: AuthPrincipal,
    groupId: string,
    input: CodeGroupUpsertValues,
  ): Promise<CodeGroupDetail> {
    await this.prisma.run(toTenantContext(user), async (tx) => {
      await this.guardWritable(tx, BigInt(groupId), user.tenantId);
      const dup = await tx.code_group.findFirst({
        where: {
          group_code: input.groupCode,
          OR: [{ tenant_id: user.tenantId }, { tenant_id: null }],
          NOT: { code_group_id: BigInt(groupId) },
        },
        select: { code_group_id: true },
      });
      if (dup)
        throw AppError.conflict('GROUP_CODE_TAKEN', '이미 쓰고 있는 그룹코드입니다.');

      await tx.code_group.update({
        where: { code_group_id: BigInt(groupId) },
        data: {
          group_code: input.groupCode,
          group_name: input.groupName,
          description: input.description || null,
          sort_order: input.sortOrder,
          is_active: input.isActive,
        },
      });
    });
    return this.detail(user, groupId);
  }

  async createCode(
    user: AuthPrincipal,
    groupId: string,
    input: CodeUpsertValues,
  ): Promise<CodeGroupDetail> {
    await this.prisma.run(toTenantContext(user), async (tx) => {
      await this.guardWritable(tx, BigInt(groupId), user.tenantId);

      const dup = await tx.code.findFirst({
        where: { code_group_id: BigInt(groupId), code_value: input.codeValue },
        select: { code_id: true },
      });
      if (dup) throw AppError.conflict('CODE_VALUE_TAKEN', '같은 그룹에 이미 있는 코드값입니다.');

      await tx.code.create({
        data: {
          code_group_id: BigInt(groupId),
          tenant_id: user.tenantId,
          code_value: input.codeValue,
          code_name: input.codeName,
          code_name_en: input.codeNameEn || null,
          parent_code_id: input.parentCodeId ? BigInt(input.parentCodeId) : null,
          sort_order: input.sortOrder,
          attr1: input.attr1 || null,
          attr2: input.attr2 || null,
          attr3: input.attr3 || null,
          description: input.description || null,
          is_active: input.isActive,
        },
      });
    });
    return this.detail(user, groupId);
  }

  async updateCode(
    user: AuthPrincipal,
    groupId: string,
    codeId: string,
    input: CodeUpsertValues,
  ): Promise<CodeGroupDetail> {
    await this.prisma.run(toTenantContext(user), async (tx) => {
      await this.guardWritable(tx, BigInt(groupId), user.tenantId);
      this.guardSelfParent(codeId, input.parentCodeId);

      const dup = await tx.code.findFirst({
        where: {
          code_group_id: BigInt(groupId),
          code_value: input.codeValue,
          NOT: { code_id: BigInt(codeId) },
        },
        select: { code_id: true },
      });
      if (dup) throw AppError.conflict('CODE_VALUE_TAKEN', '같은 그룹에 이미 있는 코드값입니다.');

      await tx.code.update({
        where: { code_id: BigInt(codeId) },
        data: {
          code_value: input.codeValue,
          code_name: input.codeName,
          code_name_en: input.codeNameEn || null,
          parent_code_id: input.parentCodeId ? BigInt(input.parentCodeId) : null,
          sort_order: input.sortOrder,
          attr1: input.attr1 || null,
          attr2: input.attr2 || null,
          attr3: input.attr3 || null,
          description: input.description || null,
          is_active: input.isActive,
        },
      });
    });
    return this.detail(user, groupId);
  }

  /**
   * 자기를 부모로 삼는 것을 막는다.
   *
   * 계층이 자기를 물면 `buildCodePreview()` 의 재귀가 그 가지에서 영영
   * 안 나온다. 더 긴 고리(A→B→A)는 코드 수가 많지 않아 화면에서 드물지만,
   * 자기 참조는 드롭다운에서 자기를 골라 한 번에 만들 수 있다.
   */
  private guardSelfParent(codeId: string, parentCodeId: string | null) {
    if (parentCodeId && parentCodeId === codeId)
      throw AppError.badRequest('SELF_PARENT', '자기를 상위 코드로 둘 수 없습니다.');
  }

  /** 끌어 옮긴 순서를 통째로 저장한다 */
  async reorder(
    user: AuthPrincipal,
    groupId: string,
    input: CodeReorderInput,
  ): Promise<CodeGroupDetail> {
    await this.prisma.run(toTenantContext(user), async (tx) => {
      await this.guardWritable(tx, BigInt(groupId), user.tenantId);

      const owned = await tx.code.findMany({
        where: { code_group_id: BigInt(groupId) },
        select: { code_id: true },
      });
      const ownedIds = new Set(owned.map((c) => String(c.code_id)));
      if (input.codeIds.some((id) => !ownedIds.has(id)))
        throw AppError.badRequest('CODE_NOT_IN_GROUP', '이 그룹에 없는 코드가 섞여 있습니다.');

      // 10 단위로 벌려 둔다. 나중에 한 줄을 사이에 끼울 때 전체를 다시
      // 번호 매기지 않아도 된다.
      for (const [index, codeId] of input.codeIds.entries()) {
        await tx.code.update({
          where: { code_id: BigInt(codeId) },
          data: { sort_order: (index + 1) * 10 },
        });
      }
    });
    return this.detail(user, groupId);
  }

  /**
   * 코드를 지운다.
   *
   * 다른 표가 코드값을 문자열로 물고 있을 수 있어 FK 로는 못 막는다.
   * 자식이 달린 코드만 확실히 막고, 나머지는 **끄기(is_active=false)** 를
   * 권한다 — 지운 코드가 과거 데이터에서 이름을 잃는 것보다 낫다.
   */
  async removeCode(
    user: AuthPrincipal,
    groupId: string,
    codeId: string,
  ): Promise<CodeGroupDetail> {
    await this.prisma.run(toTenantContext(user), async (tx) => {
      await this.guardWritable(tx, BigInt(groupId), user.tenantId);

      const children = await tx.code.count({ where: { parent_code_id: BigInt(codeId) } });
      if (children > 0)
        throw AppError.conflict(
          'CODE_HAS_CHILDREN',
          `하위 코드 ${children}건이 달려 있습니다. 하위를 먼저 정리하거나 이 코드를 끄세요.`,
        );

      await tx.code.delete({ where: { code_id: BigInt(codeId) } });
    });
    return this.detail(user, groupId);
  }
}

const GROUP_SELECT = {
  code_group_id: true,
  tenant_id: true,
  group_code: true,
  group_name: true,
  description: true,
  is_system: true,
  sort_order: true,
  is_active: true,
  code: { select: { is_active: true } },
} as const;

function toGroupItem(r: {
  code_group_id: bigint;
  tenant_id: bigint | null;
  group_code: string;
  group_name: string;
  description: string | null;
  is_system: boolean;
  sort_order: number;
  is_active: boolean;
  code: { is_active: boolean }[];
}): CodeGroupItem {
  return {
    codeGroupId: String(r.code_group_id),
    groupCode: r.group_code,
    groupName: r.group_name,
    description: r.description,
    isSystem: r.is_system,
    isShared: r.tenant_id === null,
    sortOrder: r.sort_order,
    isActive: r.is_active,
    codeCount: r.code.length,
    activeCodeCount: r.code.filter((c) => c.is_active).length,
  };
}
