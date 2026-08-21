'use client';

import { FileSearch, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABEL,
  AUDIT_ACTION_PHASE,
  AUDIT_SCOPES,
  type AuditDetail,
  type AuditListItem,
  type AuditListSummary,
  type PageResult,
} from '@ntms/shared';
import { PageHeader } from '@/components/app/page-header';
import { DiffSpine } from '@/components/system/diff-spine';
import { DataTable, Pagination, type Column } from '@/components/tms/data-table';
import { EmptyState, Panel, Stat, StatRow } from '@/components/tms/panels';
import { StatusChip } from '@/components/tms/status-chip';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/select-field';
import { TextField } from '@/components/ui/text-field';
import { useApiQuery } from '@/lib/query';
import { cn } from '@/lib/cn';

type AuditListResponse = PageResult<AuditListItem> & { summary: AuditListSummary };

interface Facets {
  tables: { value: string; label: string; count: number }[];
  actors: { value: string; label: string }[];
}

/**
 * 감사로그.
 *
 * ## 이 화면이 답하는 질문
 *
 * `audit_log` 의 주석이 답을 이미 적어 두었다 — **정산 분쟁 및 보안감사
 * 근거.** 사람이 여기 오는 이유는 로그를 구경하려는 것이 아니라, "이 금액이
 * 언제 누구 손에서 바뀌었나" 를 증명하려는 것이다.
 *
 * 그래서 이 화면은 두 부분뿐이다. **좁히는 조건**과 **바뀐 칸**.
 *
 * 목록에 JSON 을 뿌리지 않는다. 한 줄에는 "무엇이 몇 칸 바뀌었나" 만 적고,
 * 줄을 열면 변경 축이 펴진다 — 왼쪽이 이전, 오른쪽이 이후, 실제로 달라진
 * 칸만.
 *
 * ## 기간을 먼저 정한다
 *
 * `audit_log` 는 월 단위 파티션이다. 기간을 안 정하면 모든 파티션을 훑는다.
 * 그래서 기본이 최근 7일이고, 기간 칸을 화면 맨 앞에 둔다 — 좁히는 것이
 * 예의가 아니라 이 화면이 도는 조건이다.
 */
export default function SystemAuditPage() {
  const [from, setFrom] = useState(() => toDateInput(daysAgo(6)));
  const [to, setTo] = useState(() => toDateInput(new Date()));
  const [scope, setScope] = useState('ALL');
  const [table, setTable] = useState('');
  const [action, setAction] = useState('');
  const [changedBy, setChangedBy] = useState('');
  const [recordPk, setRecordPk] = useState('');
  const [recordPkInput, setRecordPkInput] = useState('');
  const [byPersonOnly, setByPersonOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(30);
  const [openId, setOpenId] = useState<string | null>(null);

  const facetPath = `/system/audit/facets?from=${from}&to=${to}`;
  const facets = useApiQuery<Facets>(['system-audit-facets', facetPath], facetPath, {
    staleTime: 60_000,
  });

  const path = useMemo(() => {
    const params = new URLSearchParams({
      from,
      to,
      scope,
      page: String(page),
      size: String(size),
      byPersonOnly: String(byPersonOnly),
    });
    if (table) params.set('table', table);
    if (action) params.set('action', action);
    if (changedBy) params.set('changedBy', changedBy);
    if (recordPk) params.set('recordPk', recordPk);
    return `/system/audit?${params.toString()}`;
  }, [from, to, scope, page, size, byPersonOnly, table, action, changedBy, recordPk]);

  const list = useApiQuery<AuditListResponse>(['system-audit', path], path);
  const summary = list.data?.summary;

  const columns: Column<AuditListItem>[] = [
    {
      key: 'when',
      header: '시각',
      width: '11rem',
      render: (a) => (
        <span className="tabular whitespace-nowrap text-content-secondary">
          {formatStamp(a.changedAt)}
        </span>
      ),
    },
    {
      key: 'target',
      header: '대상',
      render: (a) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-content-primary">{a.tableLabel}</span>
          <span className="tabular truncate text-caption text-content-tertiary">
            {a.recordPk ? `#${a.recordPk}` : '—'}
          </span>
        </span>
      ),
    },
    {
      key: 'action',
      header: '동작',
      width: '6rem',
      render: (a) => (
        <StatusChip
          label={AUDIT_ACTION_LABEL[a.action] ?? a.action}
          phase={AUDIT_ACTION_PHASE[a.action] ?? 'planned'}
        />
      ),
    },
    {
      key: 'what',
      header: '무엇이 바뀌었나',
      render: (a) => (
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-content-primary">{a.headline}</span>
          {a.action === 'UPDATE' && a.changeCount > 1 && (
            <span className="tabular shrink-0 text-caption text-content-tertiary">
              {a.changeCount}칸
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'who',
      header: '누가',
      width: '11rem',
      render: (a) =>
        a.changedByName ? (
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-content-primary">{a.changedByName}</span>
            <span className="tabular truncate text-caption text-content-tertiary">
              {a.clientIp ?? a.changedByLoginId ?? ''}
            </span>
          </span>
        ) : (
          // "미상" 이라고 쓰지 않는다. 배치와 연계가 데이터를 바꾸는 것은
          // 정상이고, 분쟁에서 첫 질문이 바로 "사람이 한 건가" 다.
          <span className="text-caption text-content-tertiary">시스템 · 배치</span>
        ),
    },
  ];

  const activeFilters =
    Boolean(table || action || changedBy || recordPk || byPersonOnly) || scope !== 'ALL';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        eyebrow="System"
        title="이 값을 언제 누가 바꿨나"
        description="변경 전후 스냅샷에서 실제로 달라진 칸만 세워 보여 줍니다. 정산 분쟁과 보안 점검의 근거입니다."
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <StatRow>
          <Stat label="변경" value={summary?.total ?? 0} unit="건" />
          <Stat label="등록" value={summary?.insertCount ?? 0} unit="건" />
          <Stat label="수정" value={summary?.updateCount ?? 0} unit="건" />
          <Stat
            label="삭제"
            value={summary?.deleteCount ?? 0}
            unit="건"
            tone={summary && summary.deleteCount > 0 ? 'warning' : 'default'}
          />
          <Stat
            label="사람이 한 변경"
            value={summary?.byPersonCount ?? 0}
            unit="건"
            hint={
              summary
                ? `${summary.actorCount}명 · 나머지는 배치·연계`
                : undefined
            }
          />
        </StatRow>

        <Panel
          className="mt-5"
          title="변경 기록"
          subtitle="줄을 누르면 바뀐 칸만 펴집니다"
          bodyClassName="p-0"
        >
          <div className="flex flex-wrap items-end gap-2 border-b border-line-subtle px-4 py-3">
            <TextField
              label="시작일"
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
              className="w-40"
            />
            <TextField
              label="종료일"
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
              className="w-40"
            />
            <SelectField
              label="업무 묶음"
              value={scope}
              options={AUDIT_SCOPES.map((s) => ({ value: s.key, label: s.label }))}
              onChange={(e) => {
                setScope(e.target.value);
                setTable('');
                setPage(1);
              }}
            />
            <SelectField
              label="표"
              placeholder="묶음 전체"
              value={table}
              options={(facets.data?.tables ?? []).map((t) => ({
                value: t.value,
                label: t.label,
                note: `${t.count}건`,
              }))}
              onChange={(e) => {
                setTable(e.target.value);
                setPage(1);
              }}
            />
            <SelectField
              label="동작"
              placeholder="전체"
              value={action}
              options={AUDIT_ACTIONS.map((a) => ({
                value: a,
                label: AUDIT_ACTION_LABEL[a] ?? a,
              }))}
              onChange={(e) => {
                setAction(e.target.value);
                setPage(1);
              }}
            />
            <SelectField
              label="변경한 사람"
              placeholder="전체"
              value={changedBy}
              options={(facets.data?.actors ?? []).map((a) => ({
                value: a.value,
                label: a.label,
              }))}
              onChange={(e) => {
                setChangedBy(e.target.value);
                setPage(1);
              }}
            />
            <TextField
              label="레코드 번호"
              placeholder="예: 1204"
              value={recordPkInput}
              onChange={(e) => setRecordPkInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setRecordPk(recordPkInput);
                  setPage(1);
                }
              }}
              className="w-36"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-line-subtle px-4 py-2.5">
            <button
              type="button"
              aria-pressed={byPersonOnly}
              onClick={() => {
                setByPersonOnly((v) => !v);
                setPage(1);
              }}
              className={cn(
                'rounded-sm border px-2.5 py-1 text-caption font-medium transition-colors duration-[var(--dur-fast)]',
                byPersonOnly
                  ? 'border-action bg-action text-action-text'
                  : 'border-line-subtle bg-surface-card text-content-secondary hover:bg-surface-sunken',
              )}
            >
              사람이 한 변경만
            </button>
            {activeFilters && (
              <button
                type="button"
                onClick={() => {
                  setScope('ALL');
                  setTable('');
                  setAction('');
                  setChangedBy('');
                  setRecordPk('');
                  setRecordPkInput('');
                  setByPersonOnly(false);
                  setPage(1);
                }}
                className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-caption text-content-secondary hover:bg-surface-sunken"
              >
                <X aria-hidden="true" className="h-3.5 w-3.5" />
                조건 지우기
              </button>
            )}
          </div>

          <DataTable
            caption="변경 기록. 시각 · 대상 · 동작 · 바뀐 칸 · 변경자."
            columns={columns}
            rows={list.data?.items ?? []}
            getRowKey={(a) => a.auditLogId}
            onRowClick={(a) => setOpenId(a.auditLogId)}
            loading={list.isLoading}
            empty={
              <EmptyState
                icon={<FileSearch aria-hidden="true" className="h-6 w-6" />}
                title="이 조건에는 변경 기록이 없습니다"
                description="기간을 넓히거나 업무 묶음을 「전체」로 두고 다시 보세요. 감사 기록은 지정된 표에만 남습니다."
              />
            }
          />

          {list.data && list.data.meta.totalPages > 1 && (
            <Pagination
              page={list.data.meta.page}
              size={list.data.meta.size}
              total={list.data.meta.total}
              onPageChange={setPage}
              onSizeChange={(next) => {
                setSize(next);
                setPage(1);
              }}
            />
          )}
        </Panel>
      </div>

      {openId && <AuditPanel auditId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function AuditPanel({ auditId, onClose }: { auditId: string; onClose: () => void }) {
  const detail = useApiQuery<AuditDetail>(
    ['system-audit-detail', auditId],
    `/system/audit/${auditId}`,
  );
  const a = detail.data;

  return (
    <aside
      className="fixed inset-y-0 right-0 z-30 flex w-full max-w-3xl flex-col border-l border-line-subtle bg-surface-card shadow-xl"
      aria-label="변경 기록 상세"
    >
      <header className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4">
        <div className="min-w-0">
          <p className="eyebrow text-content-tertiary">Audit</p>
          <h2 className="mt-1 truncate text-title font-semibold text-content-primary">
            {a ? `${a.tableLabel} ${AUDIT_ACTION_LABEL[a.action] ?? a.action}` : '불러오는 중'}
          </h2>
          {a && (
            <p className="tabular mt-0.5 text-caption text-content-tertiary">
              {formatStamp(a.changedAt)} · {a.recordPk ? `#${a.recordPk}` : '대상 없음'} ·{' '}
              {a.changedByName ?? '시스템 · 배치'}
              {a.clientIp ? ` · ${a.clientIp}` : ''}
            </p>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="닫기">
          <X aria-hidden="true" className="h-4 w-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!a ? (
          <p className="px-5 py-6 text-body text-content-secondary">불러오는 중입니다.</p>
        ) : (
          <DiffSpine diff={a.diff} action={a.action} />
        )}
      </div>

      {a?.recordPk && (
        <footer className="border-t border-line-subtle px-5 py-3">
          <p className="text-caption text-content-secondary">
            같은 레코드의 다른 변경을 보려면 목록에서 「레코드 번호」에{' '}
            <span className="tabular font-medium text-content-primary">{a.recordPk}</span>
            를 넣으세요.
          </p>
        </footer>
      )}
    </aside>
  );
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatStamp(iso: string): string {
  const d = new Date(iso);
  return `${toDateInput(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
