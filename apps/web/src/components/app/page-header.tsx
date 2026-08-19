import type { ReactNode } from 'react';

/**
 * 업무 화면의 머리.
 *
 * 화면마다 제목의 크기와 여백이 달라지면, 매일 같은 순서로 훑는 사람의
 * 눈이 매번 다시 자리를 찾아야 한다. 여기 한 곳에서 고정한다.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  /** 라틴 · 숫자만. 한글은 description 에 쓴다 */
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line-subtle px-6 py-6">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow text-content-tertiary">{eyebrow}</p>}
        <h1 className="mt-1.5 text-display-sm font-semibold text-content-primary">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-body text-content-secondary">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
