'use client';

import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import type { AuditDiff, FieldChange } from '@ntms/shared';
import { cn } from '@/lib/cn';

/**
 * 변경 축 — 바뀐 칸만.
 *
 * 감사 화면이 실패하는 방식은 늘 같다. 변경 전 JSON 과 변경 후 JSON 을
 * 나란히 놓고 "차이는 알아서 찾으세요" 라고 하는 것이다. 마흔 칸짜리 행에서
 * 그 일을 사람에게 시키면, 정산 분쟁이 났을 때 아무도 이 화면을 안 연다.
 *
 * 그래서 축을 하나만 세운다. **왼쪽이 이전, 오른쪽이 이후**, 그 사이를
 * 화살표가 잇는다. 실제로 달라진 칸만 이 축에 오른다.
 *
 * `updated_at` · `row_version` 처럼 모든 수정에 딸려 오는 칸은 접어 둔다.
 * 지우지는 않는다 — 감사 기록에서 무언가를 안 보여 주기로 했다면, 그것이
 * 있다는 사실만은 말해야 한다.
 *
 * 비밀번호 해시 같은 칸은 값을 아예 싣지 않는다(서버가 지운다). 여기서는
 * "바뀌었다" 는 사실만 적는다.
 */
export function DiffSpine({ diff, action }: { diff: AuditDiff; action: string }) {
  const [showMeta, setShowMeta] = useState(false);

  const inserted = action === 'INSERT';
  const deleted = action === 'DELETE';

  if (diff.changes.length === 0 && diff.meta.length === 0 && diff.redacted.length === 0) {
    return (
      <p className="px-4 py-6 text-body text-content-secondary">
        값이 달라진 칸이 없습니다. 같은 값으로 다시 저장했거나, 이 표에는
        스냅샷이 남지 않는 변경입니다.
      </p>
    );
  }

  return (
    <div className="px-4 py-4">
      {/*
        축 머리. 등록·삭제일 때는 한쪽만 있으므로 머리글도 바뀐다 —
        "이전 → 이후" 라고 적어 놓고 왼쪽이 통째로 비어 있으면, 읽는 사람은
        데이터가 빠진 줄 안다.
      */}
      <div className="flex items-baseline gap-3 pb-2 text-content-tertiary">
        <span className="w-36 shrink-0 text-caption">칸</span>
        <span className="eyebrow-ko flex-1">
          {inserted ? '(없었음)' : '이전'}
        </span>
        <span aria-hidden="true" className="w-4" />
        <span className="eyebrow-ko flex-1">
          {deleted ? '(지워짐)' : '이후'}
        </span>
      </div>

      <ul className="border-t border-line-subtle">
        {diff.changes.map((c) => (
          <Row key={c.field} change={c} />
        ))}
      </ul>

      {diff.redacted.length > 0 && (
        <p className="mt-3 rounded-sm bg-surface-sunken px-3 py-2 text-caption text-content-secondary">
          {diff.redacted.join(' · ')}도 바뀌었습니다. 값은 남기지 않습니다.
        </p>
      )}

      {diff.meta.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowMeta((v) => !v)}
            className="text-caption text-content-secondary underline-offset-2 hover:underline"
          >
            {showMeta ? '자동 기록 칸 접기' : `자동 기록 칸 ${diff.meta.length}개 보기`}
          </button>
          {showMeta && (
            <ul className="mt-2 border-t border-line-subtle">
              {diff.meta.map((c) => (
                <Row key={c.field} change={c} muted />
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="mt-4 text-caption text-content-tertiary">
        바뀐 칸만 세웁니다. 값이 같은 칸은 축에 오르지 않습니다.
      </p>
    </div>
  );
}

function Row({ change, muted = false }: { change: FieldChange; muted?: boolean }) {
  return (
    <li
      className={cn(
        'flex gap-3 border-b border-line-subtle py-2',
        change.long ? 'items-start' : 'items-baseline',
      )}
    >
      <span
        className={cn(
          'w-36 shrink-0 text-caption',
          muted ? 'text-content-tertiary' : 'font-medium text-content-primary',
        )}
      >
        {change.label}
        {change.label !== change.field && (
          <span className="tabular ml-1 block text-content-tertiary">{change.field}</span>
        )}
      </span>

      <Value value={change.before} tone="before" long={change.long} />

      <ArrowRight
        aria-hidden="true"
        className="mt-0.5 h-4 w-4 shrink-0 text-content-tertiary"
      />

      <Value value={change.after} tone="after" long={change.long} />
    </li>
  );
}

function Value({
  value,
  tone,
  long,
}: {
  value: string | null;
  tone: 'before' | 'after';
  long: boolean;
}) {
  if (value === null) {
    return (
      <span className="flex-1 text-caption text-content-tertiary">
        {tone === 'before' ? '없음' : '지움'}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'tabular min-w-0 flex-1 text-caption',
        // 이후 값을 강조한다. 사람이 먼저 찾는 것은 "지금 무엇으로 되어
        // 있나" 이고, 이전 값은 그것을 재는 기준이다.
        tone === 'after' ? 'text-content-primary' : 'text-content-secondary line-through',
        long && 'break-all',
      )}
    >
      {value}
    </span>
  );
}
