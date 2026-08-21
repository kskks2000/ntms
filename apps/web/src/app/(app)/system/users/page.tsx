'use client';

import { KeyRound, ShieldOff, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  PERMISSION_ACTION_LABEL,
  USER_STATUS_LABEL,
  USER_STATUS_PHASE,
  USER_TYPE_LABEL,
  type PageResult,
  type RoleSummary,
  type UserDetail,
  type UserListItem,
  type UserListSummary,
} from '@ntms/shared';
import { PageHeader } from '@/components/app/page-header';
import { AccessBadge } from '@/components/system/access-badge';
import { ReachGrid, ReachTick } from '@/components/system/reach-grid';
import { DataTable, Pagination, type Column, type SortState } from '@/components/tms/data-table';
import { EmptyState, Panel, Stat, StatRow } from '@/components/tms/panels';
import { StatusChip } from '@/components/tms/status-chip';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { SelectField } from '@/components/ui/select-field';
import { TextareaField } from '@/components/ui/textarea-field';
import { useToast } from '@/components/ui/toast';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { cn } from '@/lib/cn';

type UserListResponse = PageResult<UserListItem> & { summary: UserListSummary };

/**
 * 사용자 · 권한.
 *
 * ## 이 화면이 답하는 질문
 *
 * 계정 목록이 아니다. 관리자가 이 화면에 오는 이유는 둘 중 하나다 —
 * **누가 못 들어오고 있나**(오늘의 민원), 그리고 **누가 너무 많이 할 수
 * 있나**(분기마다 돌아오는 점검).
 *
 * 그래서 목록의 두 주인공은 이름이 아니라 **접근 상태**와 **권한 도달
 * 범위**다. 상태 칸 하나로 끝내면 "정상인데 내일부터 못 들어오는 계정" 이
 * 초록불로 보이고, 권한을 숫자로만 적으면 22개가 많은지 적은지 알 수 없다.
 *
 * 줄을 누르면 오른쪽에 **권한 격자**가 열린다. 가로축이 되돌릴 수 있는
 * 정도라, 손이 어디까지 뻗어 있는지가 숫자를 읽기 전에 보인다.
 */
export default function SystemUsersPage() {
  const toast = useToast();

  const [keyword, setKeyword] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [status, setStatus] = useState('');
  const [roleId, setRoleId] = useState('');
  const [privilegedOnly, setPrivilegedOnly] = useState(false);
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' });
  const [openId, setOpenId] = useState<string | null>(null);

  const roles = useApiQuery<RoleSummary[]>(['system-roles'], '/system/roles', {
    staleTime: 5 * 60_000,
  });

  const path = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      size: String(size),
      sort: `${sort.key}:${sort.dir}`,
      privilegedOnly: String(privilegedOnly),
      blockedOnly: String(blockedOnly),
    });
    if (keyword) params.set('keyword', keyword);
    if (status) params.set('status', status);
    if (roleId) params.set('roleId', roleId);
    return `/system/users?${params.toString()}`;
  }, [page, size, sort, privilegedOnly, blockedOnly, keyword, status, roleId]);

  const list = useApiQuery<UserListResponse>(['system-users', path], path);
  const summary = list.data?.summary;

  const columns: Column<UserListItem>[] = [
    {
      key: 'user',
      header: '사용자',
      render: (u) => (
        <span className="flex min-w-0 flex-col">
          <span
            className={cn(
              'truncate font-medium',
              !u.isActive && 'text-content-tertiary line-through',
            )}
          >
            {u.userName}
          </span>
          <span className="tabular truncate text-caption text-content-tertiary">
            {u.loginId}
          </span>
        </span>
      ),
    },
    {
      key: 'type',
      header: '구분',
      render: (u) => (
        <span className="flex min-w-0 flex-col">
          <span className="text-content-secondary">
            {USER_TYPE_LABEL[u.userType] ?? u.userType}
          </span>
          {u.partnerName && (
            <span className="truncate text-caption text-content-tertiary">
              {u.partnerName}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'roles',
      header: '역할',
      render: (u) =>
        u.roleNames.length === 0 ? (
          <span className="text-content-tertiary">없음</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {u.roleNames.map((name) => (
              <span
                key={name}
                className="rounded-sm bg-surface-sunken px-1.5 py-px text-caption text-content-secondary"
              >
                {name}
              </span>
            ))}
          </span>
        ),
    },
    {
      key: 'status',
      header: '상태',
      render: (u) => (
        <StatusChip
          label={USER_STATUS_LABEL[u.status] ?? u.status}
          phase={USER_STATUS_PHASE[u.status] ?? 'planned'}
        />
      ),
    },
    {
      key: 'access',
      header: '접근',
      width: '14rem',
      render: (u) => <AccessBadge access={u.access} />,
    },
    {
      key: 'reach',
      header: '권한',
      width: '11rem',
      sortKey: 'reach',
      render: (u) => (
        <ReachTick
          grantedCount={u.grantedCount}
          irreversibleCount={u.irreversibleCount}
          furthestLabel={u.furthestLabel}
        />
      ),
    },
    {
      key: 'lastLogin',
      header: '마지막 접속',
      sortKey: 'lastLogin',
      render: (u) =>
        u.lastLoginAt === null ? (
          <span className="text-caption text-content-tertiary">기록 없음</span>
        ) : (
          <span className="flex min-w-0 flex-col">
            <span className="tabular">{formatDay(u.lastLoginAt)}</span>
            <span className="tabular text-caption text-content-tertiary">
              {u.lastLoginIp ?? ''}
            </span>
          </span>
        ),
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        eyebrow="System"
        title="누가 어디까지 할 수 있나"
        description="계정이 지금 들어올 수 있는지, 들어오면 어디까지 되돌릴 수 없는 일을 할 수 있는지를 봅니다."
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <StatRow>
          <Stat label="계정" value={summary?.total ?? 0} unit="명" />
          <Stat label="정상" value={summary?.activeCount ?? 0} unit="명" />
          <Stat
            label="잠김"
            value={summary?.lockedCount ?? 0}
            unit="명"
            tone={summary && summary.lockedCount > 0 ? 'danger' : 'default'}
            hint={summary && summary.lockedCount > 0 ? '잠금 해제를 기다립니다' : undefined}
          />
          <Stat
            label="되돌릴 수 없는 권한 보유"
            value={summary?.privilegedCount ?? 0}
            unit="명"
            tone="warning"
            hint="삭제 · 승인 중 하나라도 가진 계정"
          />
          <Stat
            label="90일 이상 미접속"
            value={summary?.staleCount ?? 0}
            unit="명"
            hint={
              summary && summary.neverLoggedInCount > 0
                ? `한 번도 안 들어온 계정 ${summary.neverLoggedInCount}명 별도`
                : undefined
            }
          />
        </StatRow>

        <Panel
          className="mt-5"
          title="계정"
          subtitle="줄을 누르면 그 계정의 권한 격자가 열립니다"
          action={
            <div className="flex flex-wrap items-end gap-2">
              <TextField
                label="검색"
                placeholder="이름 · 로그인 ID · 이메일"
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setKeyword(keywordInput);
                    setPage(1);
                  }
                }}
                className="w-56"
              />
              <SelectField
                label="상태"
                placeholder="전체"
                value={status}
                options={Object.entries(USER_STATUS_LABEL).map(([value, label]) => ({
                  value,
                  label,
                }))}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              />
              <SelectField
                label="역할"
                placeholder="전체"
                value={roleId}
                options={(roles.data ?? []).map((r) => ({
                  value: r.roleId,
                  label: r.roleName,
                  note: `${r.userCount}명`,
                }))}
                onChange={(e) => {
                  setRoleId(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          }
        >
          {/*
            두 개의 자주 쓰는 조건은 드롭다운이 아니라 버튼으로 둔다.
            점검할 때 누르는 것이 늘 이 둘이라 한 번에 닿아야 한다.
          */}
          <div className="flex flex-wrap gap-2 border-b border-line-subtle px-4 py-3">
            <FilterToggle
              active={blockedOnly}
              onClick={() => {
                setBlockedOnly((v) => !v);
                setPage(1);
              }}
            >
              지금 못 들어오는 계정
            </FilterToggle>
            <FilterToggle
              active={privilegedOnly}
              onClick={() => {
                setPrivilegedOnly((v) => !v);
                setPage(1);
              }}
            >
              삭제 · 승인 권한 보유
            </FilterToggle>
            {(keyword || status || roleId || blockedOnly || privilegedOnly) && (
              <button
                type="button"
                onClick={() => {
                  setKeyword('');
                  setKeywordInput('');
                  setStatus('');
                  setRoleId('');
                  setBlockedOnly(false);
                  setPrivilegedOnly(false);
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
            caption="계정 목록. 접근 가능 여부와 권한 도달 범위를 함께 봅니다."
            columns={columns}
            rows={list.data?.items ?? []}
            getRowKey={(u) => u.userId}
            onRowClick={(u) => setOpenId(u.userId)}
            sort={sort}
            onSortChange={(next) => {
              setSort(next);
              setPage(1);
            }}
            loading={list.isLoading}
            empty={
              <EmptyState
                icon={<Users aria-hidden="true" className="h-6 w-6" />}
                title="조건에 맞는 계정이 없습니다"
                description="검색어나 상태 조건을 지우고 다시 보세요. 계정은 시스템 담당자가 만듭니다."
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

        <RoleOverview roles={roles.data ?? []} />
      </div>

      {openId && (
        <UserPanel
          userId={openId}
          onClose={() => setOpenId(null)}
          onDone={(message) => {
            toast.success(message);
          }}
        />
      )}
    </div>
  );
}

function FilterToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-sm border px-2.5 py-1 text-caption font-medium transition-colors duration-[var(--dur-fast)]',
        active
          ? 'border-action bg-action text-action-text'
          : 'border-line-subtle bg-surface-card text-content-secondary hover:bg-surface-sunken',
      )}
    >
      {children}
    </button>
  );
}

/**
 * 역할이 무엇을 여는가.
 *
 * 계정마다 격자를 열어 보면 결국 같은 그림 여섯 개를 반복해서 보게 된다 —
 * 권한은 역할에서만 오기 때문이다. 그래서 역할 자체의 격자를 한 번 펴 둔다.
 * 여기서 `조회전용` 이 정말 조회만 하는지 확인해 두면, 그 역할을 가진
 * 사람들은 다시 안 열어 봐도 된다.
 */
function RoleOverview({ roles }: { roles: RoleSummary[] }) {
  const [openRole, setOpenRole] = useState<string | null>(null);
  if (roles.length === 0) return null;

  return (
    <Panel
      className="mt-5"
      title="역할이 여는 것"
      subtitle="권한은 역할에서만 옵니다. 계정에 직접 붙이는 길은 없습니다"
    >
      <ul className="divide-y divide-line-subtle">
        {roles.map((role) => {
          const open = openRole === role.roleId;
          return (
            <li key={role.roleId}>
              <button
                type="button"
                onClick={() => setOpenRole(open ? null : role.roleId)}
                aria-expanded={open}
                className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-surface-sunken"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-content-primary">{role.roleName}</span>
                    <span className="eyebrow text-content-tertiary">{role.roleCode}</span>
                  </span>
                  {role.description && (
                    <span className="mt-0.5 block truncate text-caption text-content-secondary">
                      {role.description}
                    </span>
                  )}
                </span>
                <span className="tabular shrink-0 text-caption text-content-secondary">
                  {role.userCount}명
                </span>
                <span className="shrink-0">
                  <ReachTick
                    grantedCount={role.permissionCount}
                    irreversibleCount={role.irreversibleCount}
                    furthestLabel={
                      role.grid.furthest
                        ? `${role.grid.furthest.label} ${PERMISSION_ACTION_LABEL[role.grid.furthest.action]}`
                        : null
                    }
                  />
                </span>
              </button>
              {open && <ReachGrid grid={role.grid} className="px-4 pb-4" />}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/**
 * 계정 상세.
 *
 * 오른쪽에서 밀려 들어오는 판이다. 목록을 잃지 않고 한 계정을 들여다볼 수
 * 있어야 한다 — 점검은 여러 계정을 오가며 하는 일이라, 상세로 이동했다가
 * 뒤로 가기를 누르면 조건이 날아간다.
 */
function UserPanel({
  userId,
  onClose,
  onDone,
}: {
  userId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const detail = useApiQuery<UserDetail>(['system-user', userId], `/system/users/${userId}`);
  const [reason, setReason] = useState('');
  const [acting, setActing] = useState<'unlock' | 'deactivate' | null>(null);

  const unlock = useApiMutation<UserDetail, { reason: string }>(
    () => ({ path: `/system/users/${userId}/unlock`, method: 'POST' }),
    {
      invalidate: [['system-users'], ['system-user', userId]],
      onSuccess: () => {
        onDone('잠금을 풀었습니다.');
        setActing(null);
        setReason('');
      },
    },
  );

  const deactivate = useApiMutation<UserDetail, { reason: string }>(
    () => ({ path: `/system/users/${userId}/deactivate`, method: 'POST' }),
    {
      invalidate: [['system-users'], ['system-user', userId]],
      onSuccess: () => {
        onDone('계정을 막고 열려 있던 세션을 끊었습니다.');
        setActing(null);
        setReason('');
      },
    },
  );

  const u = detail.data;
  const pending = unlock.isPending || deactivate.isPending;
  const error = unlock.error ?? deactivate.error;

  return (
    <aside
      className="fixed inset-y-0 right-0 z-30 flex w-full max-w-2xl flex-col border-l border-line-subtle bg-surface-card shadow-xl"
      aria-label="계정 상세"
    >
      <header className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4">
        <div className="min-w-0">
          <p className="eyebrow text-content-tertiary">Account</p>
          <h2 className="mt-1 truncate text-title font-semibold text-content-primary">
            {u?.userName ?? '불러오는 중'}
          </h2>
          {u && (
            <p className="tabular mt-0.5 text-caption text-content-tertiary">
              {u.loginId} · {USER_TYPE_LABEL[u.userType] ?? u.userType}
            </p>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="닫기">
          <X aria-hidden="true" className="h-4 w-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {!u ? (
          <p className="text-body text-content-secondary">불러오는 중입니다.</p>
        ) : (
          <>
            <AccessBadge access={u.access} withReason />

            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line-subtle pt-4">
              <Field label="상태">
                <StatusChip
                  label={USER_STATUS_LABEL[u.status] ?? u.status}
                  phase={USER_STATUS_PHASE[u.status] ?? 'planned'}
                />
              </Field>
              <Field label="역할">
                {u.roles.length === 0 ? '없음' : u.roles.map((r) => r.roleName).join(' · ')}
              </Field>
              <Field label="이메일">{u.email ?? '—'}</Field>
              <Field label="휴대폰">{u.mobile ?? '—'}</Field>
              <Field label="마지막 접속">
                {u.lastLoginAt ? `${formatDay(u.lastLoginAt)} · ${u.lastLoginIp ?? ''}` : '기록 없음'}
              </Field>
              <Field label="로그인 실패">
                {u.loginFailCount === 0 ? '없음' : `${u.loginFailCount}회 누적`}
              </Field>
              <Field label="비밀번호">
                {u.passwordExpiresInDays === null
                  ? '만료 없음'
                  : u.passwordExpiresInDays <= 0
                    ? '만료됨'
                    : `${u.passwordExpiresInDays}일 남음`}
              </Field>
              <Field label="2단계 인증">{u.mfaEnabled ? '켜짐' : '꺼짐'}</Field>
            </dl>

            <section className="mt-6 border-t border-line-subtle pt-4">
              <h3 className="text-title-sm font-semibold text-content-primary">
                이 계정이 닿는 곳
              </h3>
              <p className="mt-1 text-caption text-content-secondary">
                권한 {u.grid.grantedCount}개 · 볼 수 있는 메뉴 {u.menuCount}개
                {u.grid.irreversibleCount > 0 &&
                  ` · 되돌릴 수 없는 권한 ${u.grid.irreversibleCount}개`}
              </p>
              <ReachGrid grid={u.grid} className="mt-3" />
            </section>

            {u.recentLogins.length > 0 && (
              <section className="mt-6 border-t border-line-subtle pt-4">
                <h3 className="text-title-sm font-semibold text-content-primary">최근 접속</h3>
                <ul className="mt-2 divide-y divide-line-subtle">
                  {u.recentLogins.map((l, i) => (
                    <li key={i} className="flex items-baseline gap-3 py-1.5">
                      <span className="tabular w-40 shrink-0 text-caption text-content-secondary">
                        {formatDay(l.loginAt)}
                      </span>
                      <span
                        className={cn(
                          'w-24 shrink-0 text-caption',
                          l.result === 'SUCCESS' ? 'text-content-secondary' : 'text-status-danger',
                        )}
                      >
                        {l.result === 'SUCCESS' ? '성공' : (l.failReason ?? '실패')}
                      </span>
                      <span className="tabular min-w-0 flex-1 truncate text-caption text-content-tertiary">
                        {l.ipAddress ?? ''} {l.deviceType ?? ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>

      {u && (
        <footer className="border-t border-line-subtle px-5 py-4">
          {error && (
            <Alert tone="danger" className="mb-3">
              {error.payload.message}
            </Alert>
          )}

          {acting ? (
            <div className="space-y-3">
              <TextareaField
                label={acting === 'unlock' ? '왜 푸나요' : '왜 막나요'}
                hint="감사로그에 그대로 남습니다. 나중에 이 결정을 설명할 사람이 읽습니다."
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  onClick={() =>
                    acting === 'unlock'
                      ? unlock.mutate({ reason })
                      : deactivate.mutate({ reason })
                  }
                  disabled={pending || reason.trim().length === 0}
                >
                  {acting === 'unlock' ? '잠금 풀기' : '계정 막기'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setActing(null);
                    setReason('');
                  }}
                >
                  그만두기
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => setActing('unlock')}
                disabled={u.access.level === 'open' && u.loginFailCount === 0}
              >
                <KeyRound aria-hidden="true" className="mr-1.5 h-4 w-4" />
                잠금 풀기
              </Button>
              <Button
                variant="ghost"
                onClick={() => setActing('deactivate')}
                disabled={!u.isActive}
              >
                <ShieldOff aria-hidden="true" className="mr-1.5 h-4 w-4" />
                계정 막기
              </Button>
            </div>
          )}
        </footer>
      )}
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow-ko text-content-tertiary">{label}</dt>
      <dd className="mt-0.5 truncate text-body text-content-primary">{children}</dd>
    </div>
  );
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
