import { Injectable } from '@nestjs/common';
import {
  auditTableLabel,
  diffSnapshot,
  tablesOfScope,
  toPageResult,
  type AuditDetail,
  type AuditListItem,
  type AuditListSummary,
  type PageResult,
} from '@ntms/shared';
import { AppError } from '../common/api-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toTenantContext, type AuthPrincipal } from '../auth/auth.types.js';

export interface AuditListQuery {
  from: string;
  to: string;
  scope: string;
  table: string | null;
  action: string | null;
  changedBy: string | null;
  recordPk: string | null;
  /** 사람이 한 변경만 (배치·시드 제외) */
  byPersonOnly: boolean;
  page: number;
  size: number;
}

/**
 * 감사로그.
 *
 * ## 이 화면이 답하는 질문
 *
 * `audit_log` 의 주석이 그 답을 이미 적어 두었다 — **정산 분쟁 및 보안감사
 * 근거.** 즉 사람이 여기 오는 이유는 로그를 구경하려는 것이 아니라,
 * "이 금액이 언제 누구 손에서 바뀌었나" 를 증명하려는 것이다.
 *
 * 그래서 목록은 필터가 전부고, 상세는 **바뀐 칸만** 보여 준다. 마흔 칸짜리
 * JSON 두 덩이를 나란히 놓으면 근거를 찾는 일이 다시 사람 몫이 된다.
 * `diffSnapshot()` 이 그 일을 대신한다.
 *
 * ## 파티션을 타게 한다
 *
 * `audit_log` 는 `changed_at` 기준 월 파티션이다. 기간 조건을 안 걸면
 * 모든 파티션을 훑는다. 그래서 컨트롤러가 기간에 기본값을 주고, 여기서도
 * 기간 없는 조회를 만들지 않는다.
 *
 * ## 사람이 아닌 변경
 *
 * `changed_by` 는 DB 세션의 `app.user_id` 에서 온다. 시드나 마이그레이션처럼
 * 그 값 없이 도는 작업은 NULL 로 남는다. 이것을 "미상" 으로 뭉뚱그리지 않고
 * **시스템**이라고 부르고 따로 셀 수 있게 둔다 — 실제 운영에서도 배치와
 * 연계가 데이터를 바꾸고, 그 구분이 분쟁에서 첫 번째 질문이다.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    user: AuthPrincipal,
    q: AuditListQuery,
  ): Promise<PageResult<AuditListItem> & { summary: AuditListSummary }> {
    return this.prisma.run(toTenantContext(user), async (tx) => {
      const range = this.range(q.from, q.to);
      const where: Record<string, unknown> = { changed_at: range };

      const scopeTables = tablesOfScope(q.scope);
      if (q.table) where.table_name = q.table;
      else if (scopeTables.length > 0) where.table_name = { in: scopeTables };

      if (q.action) where.action = q.action;
      if (q.changedBy) where.changed_by = BigInt(q.changedBy);
      else if (q.byPersonOnly) where.changed_by = { not: null };
      if (q.recordPk) where.record_pk = q.recordPk;

      const [total, rows, actionCounts, actors] = await Promise.all([
        tx.audit_log.count({ where }),
        tx.audit_log.findMany({
          where,
          select: {
            audit_log_id: true,
            changed_at: true,
            table_name: true,
            record_pk: true,
            action: true,
            changed_by: true,
            client_ip: true,
            program_id: true,
            before_data: true,
            after_data: true,
          },
          orderBy: [{ changed_at: 'desc' }, { audit_log_id: 'desc' }],
          skip: (q.page - 1) * q.size,
          take: q.size,
        }),
        tx.audit_log.groupBy({
          by: ['action'],
          where,
          _count: { _all: true },
        }),
        tx.audit_log.findMany({
          where: { ...where, changed_by: { not: null } },
          select: { changed_by: true },
          distinct: ['changed_by'],
          take: 200,
        }),
      ]);

      const names = await this.actorNames(
        tx,
        rows.map((r) => r.changed_by).filter((id): id is bigint => id !== null),
      );

      const byAction = (a: string) =>
        actionCounts.find((c) => c.action === a)?._count._all ?? 0;

      const items: AuditListItem[] = rows.map((r) => {
        const diff = diffSnapshot(
          r.before_data as Record<string, unknown> | null,
          r.after_data as Record<string, unknown> | null,
        );
        const actor = r.changed_by ? names.get(String(r.changed_by)) : null;
        return {
          auditLogId: String(r.audit_log_id),
          changedAt: r.changed_at.toISOString(),
          tableName: r.table_name,
          tableLabel: auditTableLabel(r.table_name),
          recordPk: r.record_pk,
          action: r.action,
          changedBy: r.changed_by ? String(r.changed_by) : null,
          changedByName: actor?.name ?? null,
          changedByLoginId: actor?.loginId ?? null,
          clientIp: r.client_ip ? String(r.client_ip) : null,
          programId: r.program_id,
          changeCount: diff.changes.length,
          headline: headlineOf(r.action, diff.changes),
        };
      });

      const byPersonCount = await tx.audit_log.count({
        where: { ...where, changed_by: { not: null } },
      });

      const summary: AuditListSummary = {
        total,
        insertCount: byAction('INSERT'),
        updateCount: byAction('UPDATE'),
        deleteCount: byAction('DELETE'),
        byPersonCount,
        actorCount: actors.length,
      };

      return { ...toPageResult(items, total, q.page, q.size), summary };
    });
  }

  async detail(user: AuthPrincipal, auditLogId: string): Promise<AuditDetail> {
    return this.prisma.run(toTenantContext(user), async (tx) => {
      /*
        파티션 테이블의 PK 는 (audit_log_id, changed_at) 이라 id 하나로는
        findUnique 가 안 된다. findFirst 로 훑되, 파티션 프루닝이 안 되는
        조회이므로 목록에서 넘어온 id 로만 쓴다.
      */
      const row = await tx.audit_log.findFirst({
        where: { audit_log_id: BigInt(auditLogId) },
        select: {
          audit_log_id: true,
          changed_at: true,
          table_name: true,
          record_pk: true,
          action: true,
          changed_by: true,
          client_ip: true,
          program_id: true,
          before_data: true,
          after_data: true,
        },
      });
      if (!row) throw AppError.notFound('AUDIT_NOT_FOUND', '없는 감사 기록입니다.');

      const diff = diffSnapshot(
        row.before_data as Record<string, unknown> | null,
        row.after_data as Record<string, unknown> | null,
      );
      const names = await this.actorNames(tx, row.changed_by ? [row.changed_by] : []);
      const actor = row.changed_by ? names.get(String(row.changed_by)) : null;

      return {
        auditLogId: String(row.audit_log_id),
        changedAt: row.changed_at.toISOString(),
        tableName: row.table_name,
        tableLabel: auditTableLabel(row.table_name),
        recordPk: row.record_pk,
        action: row.action,
        changedBy: row.changed_by ? String(row.changed_by) : null,
        changedByName: actor?.name ?? null,
        changedByLoginId: actor?.loginId ?? null,
        clientIp: row.client_ip ? String(row.client_ip) : null,
        programId: row.program_id,
        changeCount: diff.changes.length,
        headline: headlineOf(row.action, diff.changes),
        diff,
      };
    });
  }

  /**
   * 한 레코드의 변경 내력.
   *
   * 분쟁은 늘 "이 건" 에서 시작한다. 정산 한 줄을 열고 그 줄이 지금까지
   * 어떻게 바뀌어 왔는지를 시간순으로 본다.
   */
  async trail(
    user: AuthPrincipal,
    table: string,
    recordPk: string,
  ): Promise<AuditListItem[]> {
    return this.prisma.run(toTenantContext(user), async (tx) => {
      const rows = await tx.audit_log.findMany({
        where: { table_name: table, record_pk: recordPk },
        select: {
          audit_log_id: true,
          changed_at: true,
          table_name: true,
          record_pk: true,
          action: true,
          changed_by: true,
          client_ip: true,
          program_id: true,
          before_data: true,
          after_data: true,
        },
        orderBy: [{ changed_at: 'desc' }, { audit_log_id: 'desc' }],
        take: 100,
      });

      const names = await this.actorNames(
        tx,
        rows.map((r) => r.changed_by).filter((id): id is bigint => id !== null),
      );

      return rows.map((r) => {
        const diff = diffSnapshot(
          r.before_data as Record<string, unknown> | null,
          r.after_data as Record<string, unknown> | null,
        );
        const actor = r.changed_by ? names.get(String(r.changed_by)) : null;
        return {
          auditLogId: String(r.audit_log_id),
          changedAt: r.changed_at.toISOString(),
          tableName: r.table_name,
          tableLabel: auditTableLabel(r.table_name),
          recordPk: r.record_pk,
          action: r.action,
          changedBy: r.changed_by ? String(r.changed_by) : null,
          changedByName: actor?.name ?? null,
          changedByLoginId: actor?.loginId ?? null,
          clientIp: r.client_ip ? String(r.client_ip) : null,
          programId: r.program_id,
          changeCount: diff.changes.length,
          headline: headlineOf(r.action, diff.changes),
        };
      });
    });
  }

  /** 필터 드롭다운에 쓸 값들. 있는 것만 보여 준다 */
  async facets(
    user: AuthPrincipal,
    from: string,
    to: string,
  ): Promise<{
    tables: { value: string; label: string; count: number }[];
    actors: { value: string; label: string }[];
  }> {
    return this.prisma.run(toTenantContext(user), async (tx) => {
      const range = this.range(from, to);
      const [tables, actorRows] = await Promise.all([
        tx.audit_log.groupBy({
          by: ['table_name'],
          where: { changed_at: range },
          _count: { _all: true },
        }),
        tx.audit_log.findMany({
          where: { changed_at: range, changed_by: { not: null } },
          select: { changed_by: true },
          distinct: ['changed_by'],
          take: 200,
        }),
      ]);

      const names = await this.actorNames(
        tx,
        actorRows.map((r) => r.changed_by).filter((id): id is bigint => id !== null),
      );

      return {
        tables: tables
          .map((t) => ({
            value: t.table_name,
            label: auditTableLabel(t.table_name),
            count: t._count._all,
          }))
          .sort((a, b) => b.count - a.count),
        actors: [...names.entries()].map(([id, a]) => ({
          value: id,
          label: `${a.name} (${a.loginId})`,
        })),
      };
    });
  }

  private async actorNames(
    tx: Parameters<Parameters<PrismaService['run']>[1]>[0],
    ids: bigint[],
  ): Promise<Map<string, { name: string; loginId: string }>> {
    const unique = [...new Set(ids.map(String))].map(BigInt);
    if (unique.length === 0) return new Map();
    const rows = await tx.user_account.findMany({
      where: { user_id: { in: unique } },
      select: { user_id: true, user_name: true, login_id: true },
    });
    return new Map(
      rows.map((r) => [String(r.user_id), { name: r.user_name, loginId: r.login_id }]),
    );
  }

  /**
   * 기간을 UTC 경계로 만든다.
   *
   * `to` 는 그날 끝까지 포함해야 한다. `lte: to` 로 두면 그날 00:00 까지만
   * 잡혀 오늘 것이 하나도 안 나온다 — 화면은 멀쩡히 그려지고 "오늘은
   * 아무 일도 없었다" 고 말한다.
   */
  private range(from: string, to: string) {
    const start = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    return { gte: start, lt: end };
  }
}

/**
 * 목록 한 줄에 적을 요약.
 *
 * 사람이 목록에서 원하는 것은 "무엇이 바뀌었나" 한 마디다. 바뀐 칸이
 * 하나면 그 칸 이름을, 여럿이면 첫 칸과 나머지 수를 적는다.
 */
function headlineOf(action: string, changes: { label: string }[]): string {
  if (action === 'INSERT') return '새로 만들어짐';
  if (action === 'DELETE') return '지워짐';
  if (changes.length === 0) return '값 변화 없음';
  if (changes.length === 1) return `${changes[0]!.label} 변경`;
  return `${changes[0]!.label} 외 ${changes.length - 1}칸`;
}
