'use client';

import { Check, CircleAlert, Info, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';

/**
 * 알림 한 줄.
 *
 * 기준정보를 고치고 저장하면 서랍이 닫히고 목록이 갱신된다. 등록은 총계가
 * 하나 늘어 눈에 띄지만, **값만 고친 수정은 화면이 거의 그대로다** — 저장이
 * 됐는지 안 됐는지 사람이 알 방법이 없다. 그 빈자리를 메운다.
 *
 * 설계에서 지킨 것 셋:
 *
 * 1. **작업을 막지 않는다.** 화면 구석에서 스스로 사라진다. 확인을 눌러야
 *    없어지는 알림은 여러 건을 이어서 고칠 때 손을 한 번씩 더 쓰게 한다.
 * 2. **한 일을 그대로 말한다.** "성공" 이 아니라 "차량을 등록했습니다".
 *    무엇이 일어났는지가 남아야 되돌릴 것을 판단할 수 있다.
 * 3. **실패는 오래 둔다.** 성공은 3초면 충분하지만 오류는 읽고 조치해야
 *    하므로 두 배로 둔다.
 */
export type ToastTone = 'success' | 'danger' | 'info';

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
  /** 문구 아래 한 줄. 무엇이 막았는지 같은 것 */
  detail?: string;
}

interface ToastApi {
  success: (message: string, detail?: string) => void;
  danger: (message: string, detail?: string) => void;
  info: (message: string, detail?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** 성공은 읽고 넘기면 그만, 오류는 읽고 조치해야 한다 */
const LIFETIME: Record<ToastTone, number> = {
  success: 3200,
  info: 3600,
  danger: 6500,
};

const TONE = {
  success: {
    icon: Check,
    ring: 'border-status-success/35',
    accent: 'text-status-success',
  },
  danger: {
    icon: CircleAlert,
    ring: 'border-status-danger/35',
    accent: 'text-status-danger',
  },
  info: {
    icon: Info,
    ring: 'border-line-strong',
    accent: 'text-content-accent',
  },
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string, detail?: string) => {
      const id = ++seq.current;
      // 쌓이면 화면을 가린다. 최근 셋만 남긴다.
      setItems((prev) => [...prev.slice(-2), { id, tone, message, detail }]);
      window.setTimeout(() => remove(id), LIFETIME[tone]);
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m, d) => push('success', m, d),
      danger: (m, d) => push('danger', m, d),
      info: (m, d) => push('info', m, d),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}

      {/*
        aria-live=polite — 낭독기가 지금 읽던 것을 끊지 않고 이어서 알린다.
        저장 알림은 급한 소식이 아니다.
      */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[min(24rem,calc(100vw-2.5rem))] flex-col gap-2"
      >
        {items.map((t) => {
          const { icon: Icon, ring, accent } = TONE[t.tone];
          return (
            <div
              key={t.id}
              role={t.tone === 'danger' ? 'alert' : 'status'}
              className={cn(
                'pointer-events-auto flex items-start gap-2.5 rounded-card border bg-surface-card px-3.5 py-3 shadow-lg',
                'motion-safe:animate-[ntms-toast-in_200ms_ease-out]',
                ring,
              )}
            >
              <Icon
                size={16}
                strokeWidth={2}
                aria-hidden="true"
                className={cn('mt-0.5 shrink-0', accent)}
              />
              <div className="min-w-0 flex-1">
                <p className="text-label text-content-primary">{t.message}</p>
                {t.detail && (
                  <p className="mt-0.5 text-caption text-content-tertiary">{t.detail}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => remove(t.id)}
                aria-label="알림 닫기"
                className="-mr-1 -mt-1 shrink-0 rounded p-1 text-content-tertiary transition-colors hover:bg-surface-sunken hover:text-content-primary"
              >
                <X size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * 알림을 띄운다.
 *
 * Provider 밖에서 부르면 조용히 아무 일도 하지 않는다 — 알림이 안 뜨는 것이
 * 화면이 통째로 죽는 것보다 낫다. 대신 개발 중에는 콘솔에 남긴다.
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  return (
    ctx ?? {
      success: (m) => console.warn('[toast] Provider 밖에서 호출:', m),
      danger: (m) => console.warn('[toast] Provider 밖에서 호출:', m),
      info: (m) => console.warn('[toast] Provider 밖에서 호출:', m),
    }
  );
}
