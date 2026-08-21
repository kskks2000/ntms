'use client';

import { useState } from 'react';
import {
  PERMISSION_ACTIONS,
  PERMISSION_ACTION_LABEL,
  isIrreversible,
  type ReachCell,
  type ReachGrid as ReachGridData,
} from '@ntms/shared';
import { cn } from '@/lib/cn';

/**
 * 권한 격자 — 이 화면의 얼굴.
 *
 * 세로는 업무 영역, 가로는 동작이다. 가로축의 순서가 이 그림의 전부다:
 * **왼쪽은 아무것도 바꾸지 않는 일, 오른쪽은 되돌릴 수 없는 일.**
 * 조회 → 등록 → 수정 → 내보내기 → 삭제 → 승인.
 *
 * 그래서 한 사람의 격자를 보면 숫자를 읽기 전에 손이 어디까지 뻗어 있는지가
 * 먼저 보인다. 조회만 하면 되는 사람의 칸이 오른쪽 두 열까지 차 있으면,
 * 그것이 이 화면이 하려는 말 전부다.
 *
 * 안 가진 권한도 **윤곽으로 남긴다.** 가진 것만 그리면 격자가 사람마다
 * 다른 모양이 되어 비교가 안 되고, "이 사람에게 없는 것" 이 안 보인다.
 * 그게 이 화면의 절반이다.
 *
 * 아예 존재하지 않는 권한(그 영역에 그 동작이 없다)은 빈칸으로 둔다.
 * 없는 것과 안 준 것은 다르다.
 */

/** 되돌릴 수 없는 열이 시작되는 자리. 여기서부터 배경을 한 단 어둡게 깐다 */
const DANGER_FROM = PERMISSION_ACTIONS.findIndex((a) => isIrreversible(a));

export function ReachGrid({
  grid,
  className,
}: {
  grid: ReachGridData;
  className?: string;
}) {
  const [hovered, setHovered] = useState<ReachCell | null>(null);

  return (
    <div className={cn('min-w-0', className)}>
      {/*
        위험 구역을 열 배경으로 깐다. 셀마다 색을 바꾸면 격자가 알록달록해져
        정작 "채워졌다/비었다" 가 안 읽힌다. 구역은 배경이 맡고 셀은 채움만
        맡는다.
      */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-separate border-spacing-0">
          <caption className="sr-only">
            업무 영역별 권한. 오른쪽 열로 갈수록 되돌리기 어려운 동작입니다.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="w-28 pb-2 text-left align-bottom">
                <span className="eyebrow-ko text-content-tertiary">업무 영역</span>
              </th>
              {PERMISSION_ACTIONS.map((action, i) => (
                <th
                  key={action}
                  scope="col"
                  className={cn(
                    'px-1 pb-2 align-bottom',
                    i >= DANGER_FROM && 'bg-status-danger-surface/40',
                    i === DANGER_FROM && 'rounded-t-sm',
                  )}
                >
                  <span
                    className={cn(
                      'block text-center text-caption font-medium',
                      i >= DANGER_FROM ? 'text-status-danger' : 'text-content-tertiary',
                    )}
                  >
                    {PERMISSION_ACTION_LABEL[action]}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr key={row.domain}>
                <th
                  scope="row"
                  className="border-t border-line-subtle py-1.5 pr-2 text-left text-caption font-medium text-content-secondary"
                >
                  {row.label}
                </th>
                {row.cells.map((cell, i) => (
                  <td
                    key={cell.action}
                    className={cn(
                      'border-t border-line-subtle px-1 py-1.5',
                      i >= DANGER_FROM && 'bg-status-danger-surface/40',
                    )}
                  >
                    <Cell
                      cell={cell}
                      domainLabel={row.label}
                      onHover={setHovered}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/*
        범례. 격자에서 셋을 구분해야 하는데 색만으로는 "없는 칸" 과 "안 준 칸"
        이 안 갈린다. 모양이 다르다는 것을 여기서 한 번 알려 준다.
      */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-caption text-content-tertiary">
        <Legend swatch={<span className="h-3 w-3 rounded-sm bg-action" />}>
          가지고 있음
        </Legend>
        <Legend
          swatch={
            <span className="h-3 w-3 rounded-sm border border-dashed border-line-strong" />
          }
        >
          줄 수 있으나 안 줌
        </Legend>
        <Legend swatch={<span className="h-3 w-3 text-content-tertiary">·</span>}>
          해당 없음
        </Legend>
        <span className="text-content-tertiary">
          오른쪽 두 열(삭제 · 승인)은 되돌릴 수 없습니다.
        </span>
      </div>

      {/*
        손을 올린 칸의 설명. 격자 밖 한 줄에 고정으로 둔다 — 툴팁으로 띄우면
        키보드 사용자가 못 읽고, 셀마다 말풍선이 뜨면 격자가 가려진다.
      */}
      <p
        className="mt-2 min-h-[1.25rem] text-caption text-content-secondary"
        aria-live="polite"
      >
        {hovered ? describe(hovered) : ''}
      </p>
    </div>
  );
}

function Legend({
  swatch,
  children,
}: {
  swatch: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="inline-flex h-3 w-3 items-center justify-center">
        {swatch}
      </span>
      {children}
    </span>
  );
}

function Cell({
  cell,
  domainLabel,
  onHover,
}: {
  cell: ReachCell;
  domainLabel: string;
  onHover: (cell: ReachCell | null) => void;
}) {
  if (cell.permissionCode === null) {
    return (
      <span className="mx-auto block text-center text-caption text-content-tertiary/50">
        ·<span className="sr-only">{domainLabel}에는 이 동작이 없습니다</span>
      </span>
    );
  }

  const danger = isIrreversible(cell.action);

  return (
    <button
      type="button"
      // 누르는 버튼이 아니라 읽는 칸이다. 그래도 button 인 이유는 키보드로
      // 탭을 돌며 설명을 읽을 수 있어야 하기 때문이다.
      onMouseEnter={() => onHover(cell)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(cell)}
      onBlur={() => onHover(null)}
      aria-label={`${domainLabel} ${PERMISSION_ACTION_LABEL[cell.action]} — ${
        cell.granted ? `있음 (${cell.viaRoles.join(', ')})` : '없음'
      }`}
      className={cn(
        'mx-auto block h-5 w-full max-w-[2.75rem] rounded-sm border transition-colors duration-[var(--dur-fast)]',
        cell.granted
          ? danger
            ? 'border-status-danger bg-status-danger'
            : 'border-action bg-action'
          : 'border-dashed border-line-strong bg-transparent hover:bg-surface-sunken',
      )}
    />
  );
}

function describe(cell: ReachCell): string {
  const name = cell.permissionName ?? cell.permissionCode ?? '';
  if (!cell.granted) return `${name} — 없습니다.`;
  if (cell.viaRoles.length === 1) return `${name} — ‘${cell.viaRoles[0]}’ 역할이 줍니다.`;
  return `${name} — ${cell.viaRoles.map((r) => `‘${r}’`).join(' · ')} 역할이 겹쳐서 줍니다.`;
}

/**
 * 목록 한 줄에 들어가는 축소판.
 *
 * 격자를 통째로 넣을 수는 없지만, 숫자만 적으면 "22개" 가 많은 건지 적은
 * 건지 알 수 없다. 그래서 **가장 오른쪽까지 닿은 자리**를 한 마디로 적고,
 * 되돌릴 수 없는 권한 수를 옆에 붙인다.
 */
export function ReachTick({
  grantedCount,
  irreversibleCount,
  furthestLabel,
}: {
  grantedCount: number;
  irreversibleCount: number;
  furthestLabel: string | null;
}) {
  if (grantedCount === 0) {
    return <span className="text-caption text-content-tertiary">권한 없음</span>;
  }

  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="flex items-center gap-1.5">
        <span className="tabular text-body text-content-primary">{grantedCount}</span>
        {irreversibleCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-sm bg-status-danger-surface px-1.5 py-px text-caption font-medium text-status-danger">
            <span className="tabular">{irreversibleCount}</span>
            되돌릴 수 없음
          </span>
        )}
      </span>
      {furthestLabel && (
        <span className="truncate text-caption text-content-tertiary">
          {furthestLabel}까지
        </span>
      )}
    </span>
  );
}
