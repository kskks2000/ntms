'use client';

import { ChevronDown, Globe, Lock, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  buildCodePreview,
  type CodeGroupDetail,
  type CodeGroupItem,
  type CodeItem,
  type CodeUpsertInput,
} from '@ntms/shared';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState, Panel } from '@/components/tms/panels';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { TextField } from '@/components/ui/text-field';
import { useToast } from '@/components/ui/toast';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { cn } from '@/lib/cn';

/**
 * 공통코드.
 *
 * ## 이 화면의 결과물은 표가 아니다
 *
 * 관리자가 여기서 하는 일 — 코드를 끄고, 순서를 바꾸고, 이름을 고치는 것 —
 * 은 전부 **다른 화면의 선택 목록**으로 나타난다. 그런데 보통의 코드 관리
 * 화면은 편집용 표만 보여 준다. 그래서 관리자는 자기가 무엇을 바꿨는지
 * 확인하려고 오더 등록 화면을 따로 열어 본다.
 *
 * 그래서 축을 이렇게 세운다 — **왼쪽은 고치는 표, 오른쪽은 그 결과.**
 * 코드를 끄면 오른쪽에서 사라지고, 순서를 올리면 오른쪽에서 올라간다.
 * 부모를 끄면 자식까지 통째로 빠진다. 그 규칙을 글로 설명하는 대신
 * 그대로 보여 준다.
 *
 * 미리보기는 화면이 자기 식으로 그리지 않는다. 실제 드롭다운이 쓰는
 * `buildCodePreview()` 를 그대로 부른다 — 미리보기가 진짜와 다르면
 * 그것은 미리보기가 아니라 거짓말이다.
 */
export default function SystemCodesPage() {
  const toast = useToast();
  const [keyword, setKeyword] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const groupsPath = keyword
    ? `/system/code-groups?keyword=${encodeURIComponent(keyword)}`
    : '/system/code-groups';
  const groups = useApiQuery<CodeGroupItem[]>(['system-code-groups', groupsPath], groupsPath);

  // 처음 들어오면 첫 그룹을 연다. 빈 오른쪽 판을 보여 주고 "고르세요" 라고
  // 하는 것보다, 하나를 열어 두는 편이 이 화면이 무엇인지 빨리 말한다.
  useEffect(() => {
    if (!selectedId && groups.data && groups.data.length > 0) {
      setSelectedId(groups.data[0]!.codeGroupId);
    }
  }, [groups.data, selectedId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        eyebrow="System"
        title="끄면 화면에서 무엇이 사라지나"
        description="여기서 고친 코드가 다른 화면의 선택 목록이 됩니다. 오른쪽이 그 결과입니다."
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-y-auto px-6 py-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <Panel
          title="코드 그룹"
          subtitle={groups.data ? `${groups.data.length}개` : undefined}
          bodyClassName="p-0"
        >
          <div className="border-b border-line-subtle px-3 py-3">
            <TextField
              label="그룹 찾기"
              placeholder="그룹코드 · 이름"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>

          {groups.data && groups.data.length === 0 ? (
            <EmptyState
              title="찾는 그룹이 없습니다"
              description="검색어를 지우면 전체 그룹이 나옵니다."
            />
          ) : (
            <ul className="max-h-[32rem] overflow-y-auto">
              {(groups.data ?? []).map((g) => (
                <li key={g.codeGroupId}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(g.codeGroupId)}
                    aria-current={selectedId === g.codeGroupId}
                    className={cn(
                      'flex w-full items-start gap-2 border-b border-line-subtle px-3 py-2.5 text-left transition-colors duration-[var(--dur-fast)]',
                      selectedId === g.codeGroupId
                        ? 'bg-surface-sunken'
                        : 'hover:bg-surface-sunken',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-body font-medium text-content-primary">
                          {g.groupName}
                        </span>
                        {g.isSystem && (
                          <Lock
                            aria-label="시스템 코드 — 고칠 수 없음"
                            className="h-3.5 w-3.5 shrink-0 text-content-tertiary"
                          />
                        )}
                        {g.isShared && (
                          <Globe
                            aria-label="전 회사 공용 — 고칠 수 없음"
                            className="h-3.5 w-3.5 shrink-0 text-content-tertiary"
                          />
                        )}
                      </span>
                      <span className="eyebrow mt-0.5 block truncate text-content-tertiary">
                        {g.groupCode}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-caption text-content-tertiary">
                      {g.activeCodeCount}
                      {g.activeCodeCount !== g.codeCount && (
                        <span className="text-content-tertiary">/{g.codeCount}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="px-3 py-3 text-caption text-content-tertiary">
            숫자는 살아 있는 코드 수입니다. 꺼 둔 코드가 있으면 전체 수를 함께
            적습니다.
          </p>
        </Panel>

        {selectedId ? (
          <GroupEditor
            groupId={selectedId}
            onDone={(m) => toast.success(m)}
            onError={(m) => toast.danger(m)}
          />
        ) : (
          <Panel title="코드">
            <EmptyState
              title="왼쪽에서 그룹을 고르세요"
              description="그룹을 고르면 그 안의 코드와, 그 코드가 실제 화면에서 어떻게 보이는지가 나란히 열립니다."
            />
          </Panel>
        )}
      </div>
    </div>
  );
}

/**
 * 고치는 표와 그 결과를 나란히 둔다.
 *
 * 두 판의 높이를 맞추지 않는다. 왼쪽은 편집이라 줄이 길고 오른쪽은 결과라
 * 짧다. 억지로 맞추면 오른쪽에 빈 공간이 생기고, 그 빈 공간이 "여기 뭔가
 * 빠졌나" 로 읽힌다.
 */
function GroupEditor({
  groupId,
  onDone,
  onError,
}: {
  groupId: string;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const detail = useApiQuery<CodeGroupDetail>(
    ['system-code-group', groupId],
    `/system/code-groups/${groupId}`,
  );
  const [draftOpen, setDraftOpen] = useState(false);

  const g = detail.data;
  const locked = Boolean(g && (g.isSystem || g.isShared));

  /*
    미리보기를 서버 응답 대신 **화면의 현재 상태**로 다시 계산한다.

    코드를 껐다 켤 때마다 서버를 다녀오면 오른쪽이 한 박자 늦게 바뀌고,
    그 지연이 "내가 끈 게 반영이 안 되나" 로 읽힌다. 같은 함수를 화면에서
    부르므로 결과는 서버와 같다.
  */
  const [localCodes, setLocalCodes] = useState<CodeItem[] | null>(null);
  useEffect(() => setLocalCodes(null), [groupId, detail.dataUpdatedAt]);
  const codes = localCodes ?? g?.codes ?? [];

  const preview = useMemo(
    () =>
      buildCodePreview(
        codes.map((c) => ({
          codeValue: c.codeValue,
          codeName: c.codeName,
          sortOrder: c.sortOrder,
          isActive: c.isActive,
          parentCodeValue: c.parentCodeValue,
        })),
      ),
    [codes],
  );

  /*
    변수 객체가 그대로 요청 본문이 된다(`useApiMutation`). 그래서 `codeId` 를
    한 겹 안에 넣으면 서버가 받는 본문이 `{ codeId, body }` 가 되어 스키마에
    걸린다. 평평하게 펴서 보내고 경로에 쓸 id 만 골라 쓴다 — zod 가 모르는
    키는 알아서 떨어뜨린다.
  */
  const save = useApiMutation<CodeGroupDetail, CodeUpsertInput & { codeId: string }>(
    ({ codeId }) => ({
      path: `/system/code-groups/${groupId}/codes/${codeId}`,
      method: 'PATCH',
    }),
    {
      invalidate: [['system-code-group', groupId], ['system-code-groups']],
      onSuccess: () => onDone('저장했습니다.'),
    },
  );

  const create = useApiMutation<CodeGroupDetail, CodeUpsertInput>(
    () => ({ path: `/system/code-groups/${groupId}/codes`, method: 'POST' }),
    {
      invalidate: [['system-code-group', groupId], ['system-code-groups']],
      onSuccess: () => {
        onDone('코드를 추가했습니다.');
        setDraftOpen(false);
      },
    },
  );

  if (!g) {
    return (
      <Panel title="코드">
        <p className="px-4 py-6 text-body text-content-secondary">불러오는 중입니다.</p>
      </Panel>
    );
  }

  const toggleActive = (code: CodeItem) => {
    // 화면을 먼저 바꾸고 서버에 보낸다. 미리보기가 즉시 반응해야 이 화면의
    // 요점이 전달된다. 실패하면 invalidate 로 서버 값이 다시 덮는다.
    setLocalCodes(
      codes.map((c) => (c.codeId === code.codeId ? { ...c, isActive: !c.isActive } : c)),
    );
    save.mutate(
      { codeId: code.codeId, ...toUpsert({ ...code, isActive: !code.isActive }) },
      { onError: (e) => onError(e.payload.message) },
    );
  };

  return (
    <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <Panel
        title={g.groupName}
        subtitle={g.description ?? undefined}
        bodyClassName="p-0"
        action={
          !locked && (
            <Button size="sm" variant="secondary" onClick={() => setDraftOpen((v) => !v)}>
              <Plus aria-hidden="true" className="mr-1 h-4 w-4" />
              코드 추가
            </Button>
          )
        }
      >
        {locked && (
          <div className="px-4 pt-4">
            <Alert tone="info" title={g.isShared ? '전 회사 공용 코드' : '시스템 코드'}>
              {g.isShared
                ? '모든 회사가 같은 표를 봅니다. 한 회사에서 고치면 다른 회사 화면이 바뀌므로 여기서는 읽기만 됩니다.'
                : '앱이 이 코드값을 직접 참조합니다. 값이 바뀌면 화면이 코드를 못 찾으므로 잠가 두었습니다.'}
            </Alert>
          </div>
        )}

        {draftOpen && !locked && (
          <CodeDraft
            existing={codes}
            onCancel={() => setDraftOpen(false)}
            onSubmit={(body) =>
              create.mutate(body, { onError: (e) => onError(e.payload.message) })
            }
            pending={create.isPending}
          />
        )}

        <ul className="divide-y divide-line-subtle">
          {codes.map((c) => (
            <li
              key={c.codeId}
              className={cn(
                'flex items-center gap-3 px-4 py-2.5',
                !c.isActive && 'bg-surface-sunken/60',
              )}
            >
              <span className="tabular w-8 shrink-0 text-caption text-content-tertiary">
                {c.sortOrder}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  {c.parentCodeValue && (
                    <span aria-hidden="true" className="text-content-tertiary">
                      └
                    </span>
                  )}
                  <span
                    className={cn(
                      'truncate text-body',
                      c.isActive ? 'text-content-primary' : 'text-content-tertiary',
                    )}
                  >
                    {c.codeName}
                  </span>
                  {c.attr1 && (
                    <span className="shrink-0 rounded-sm bg-surface-sunken px-1.5 py-px text-caption text-content-secondary">
                      {c.attr1}
                    </span>
                  )}
                </span>
                <span className="eyebrow mt-0.5 block truncate text-content-tertiary">
                  {c.codeValue}
                  {c.codeNameEn && (
                    <span className="ml-2 normal-case tracking-normal">{c.codeNameEn}</span>
                  )}
                </span>
              </span>

              <Checkbox
                label="사용"
                checked={c.isActive}
                disabled={locked || save.isPending}
                onChange={() => toggleActive(c)}
              />
            </li>
          ))}
        </ul>

        {codes.length === 0 && (
          <EmptyState
            title="아직 코드가 없습니다"
            description={
              locked
                ? '이 그룹은 잠겨 있어 여기서 추가할 수 없습니다.'
                : '「코드 추가」를 눌러 첫 줄을 만드세요. 만든 코드는 오른쪽 미리보기에 바로 나타납니다.'
            }
          />
        )}
      </Panel>

      <CodePreview
        groupName={g.groupName}
        preview={preview}
        hiddenCount={codes.length - preview.length}
      />
    </div>
  );
}

/**
 * 오른쪽 판 — 이 코드가 실제 화면에서 어떻게 보이나.
 *
 * 진짜 드롭다운처럼 그린다. 표 흉내를 내면 "이것도 편집하는 곳인가" 로
 * 읽히고, 그러면 두 판의 역할이 흐려진다.
 */
function CodePreview({
  groupName,
  preview,
  hiddenCount,
}: {
  groupName: string;
  preview: { codeValue: string; codeName: string; depth: number }[];
  hiddenCount: number;
}) {
  return (
    <Panel title="다른 화면에서는 이렇게 보입니다" bodyClassName="p-4">
      <div className="rounded-md border border-line-field bg-surface-field">
        <div className="flex items-center justify-between border-b border-line-subtle px-3 py-2">
          <span className="text-caption text-content-tertiary">{groupName}</span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 text-content-tertiary" />
        </div>
        {preview.length === 0 ? (
          <p className="px-3 py-4 text-caption text-content-tertiary">
            고를 수 있는 값이 없습니다. 코드를 켜기 전까지 이 목록은 비어 있습니다.
          </p>
        ) : (
          <ul className="max-h-80 overflow-y-auto py-1">
            {preview.map((o) => (
              <li
                key={o.codeValue}
                className="px-3 py-1.5 text-body text-content-primary"
                style={{ paddingLeft: `${0.75 + o.depth * 1}rem` }}
              >
                {o.codeName}
              </li>
            ))}
          </ul>
        )}
      </div>

      <dl className="mt-3 space-y-1 text-caption">
        <div className="flex justify-between">
          <dt className="text-content-tertiary">고를 수 있는 값</dt>
          <dd className="tabular text-content-primary">{preview.length}개</dd>
        </div>
        {hiddenCount > 0 && (
          <div className="flex justify-between">
            <dt className="text-content-tertiary">꺼서 빠진 값</dt>
            <dd className="tabular text-content-secondary">{hiddenCount}개</dd>
          </div>
        )}
      </dl>

      <p className="mt-3 text-caption text-content-tertiary">
        꺼 둔 코드는 목록에서 빠집니다. 상위 코드를 끄면 그 아래 코드도 함께
        사라집니다. 이미 그 값을 쓰고 있는 과거 데이터는 그대로 남습니다.
      </p>
    </Panel>
  );
}

/** 새 코드 한 줄. 저장 전까지 미리보기에는 안 올린다 — 아직 없는 값이다 */
function CodeDraft({
  existing,
  onCancel,
  onSubmit,
  pending,
}: {
  existing: CodeItem[];
  onCancel: () => void;
  onSubmit: (body: CodeUpsertInput) => void;
  pending: boolean;
}) {
  const [codeValue, setCodeValue] = useState('');
  const [codeName, setCodeName] = useState('');

  const nextOrder = existing.reduce((max, c) => Math.max(max, c.sortOrder), 0) + 10;

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          codeValue: codeValue.toUpperCase(),
          codeName,
          codeNameEn: '',
          parentCodeId: null,
          sortOrder: nextOrder,
          attr1: '',
          attr2: '',
          attr3: '',
          description: '',
          isActive: true,
        });
      }}
      className="flex flex-wrap items-end gap-3 border-b border-line-subtle bg-surface-sunken/60 px-4 py-3"
    >
      <TextField
        label="코드값"
        hint="영문 대문자 · 숫자 · _ -"
        placeholder="예: TRAFFIC"
        value={codeValue}
        onChange={(e) => setCodeValue(e.target.value.toUpperCase())}
        className="w-40"
        required
      />
      <TextField
        label="코드명"
        placeholder="화면에 보이는 이름"
        value={codeName}
        onChange={(e) => setCodeName(e.target.value)}
        className="w-56"
        required
      />
      <Button type="submit" size="sm" disabled={pending || !codeValue || !codeName}>
        추가하기
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        그만두기
      </Button>
    </form>
  );
}

/** 목록의 한 줄을 그대로 수정 입력으로 옮긴다 */
function toUpsert(c: CodeItem): CodeUpsertInput {
  return {
    codeValue: c.codeValue,
    codeName: c.codeName,
    codeNameEn: c.codeNameEn ?? '',
    parentCodeId: c.parentCodeId,
    sortOrder: c.sortOrder,
    attr1: c.attr1 ?? '',
    attr2: c.attr2 ?? '',
    attr3: c.attr3 ?? '',
    description: c.description ?? '',
    isActive: c.isActive,
  };
}
