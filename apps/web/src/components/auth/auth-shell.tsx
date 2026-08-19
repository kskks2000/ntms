import type { ReactNode } from 'react';
import { NtmsMark } from '@/components/brand/ntms-mark';
import { TripDiagram } from './trip-diagram';

/**
 * 인증 화면의 골격.
 *
 *   [ 레일 ][      관제 캔버스      ][   폼   ]
 *     76px         남는 폭            33rem
 *
 * 레일은 제품의 척추다. 로그인 이후 앱 셸에서 접힌 내비게이션 레일이
 * 같은 자리에 그대로 남는다. 처음 보는 화면과 매일 보는 화면이 같은
 * 뼈대를 공유하게 하려는 것이다.
 *
 * 1024px 아래에서는 캔버스를 접고 레일을 상단 바로 눕힌다. 폼은 어느
 * 폭에서도 한 단으로 유지된다.
 */
export function AuthShell({
  headline,
  lead,
  children,
}: {
  headline: ReactNode;
  lead: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <TopBar />
      <Rail />

      {/* --- 관제 캔버스 -------------------------------------------- */}
      <section className="relative hidden flex-1 flex-col overflow-hidden bg-canvas-850 px-12 py-14 lg:flex xl:px-16">
        <div className="max-w-[38rem]">
          <p
            className="eyebrow-ko animate-rise text-canvas-400"
            style={{ animationDelay: '40ms' }}
          >
            통합 연계 운송관리시스템
          </p>
          {/*
            제목이 아니라 브랜드 진술이다. 이 화면의 h1 은 폼 쪽의 '로그인' 이다.
            게다가 이 영역은 1024px 아래에서 통째로 감춰지므로, 여기에 h1 을 두면
            모바일에서는 h1 없이 h2 부터 시작하는 문서가 되어 버린다.
          */}
          <p
            className="animate-rise mt-5 text-display font-semibold text-canvas-50"
            style={{ animationDelay: '90ms' }}
          >
            {headline}
          </p>
          <p
            className="animate-rise mt-4 max-w-[34rem] text-lead text-canvas-300"
            style={{ animationDelay: '150ms' }}
          >
            {lead}
          </p>
        </div>

        <TripDiagram className="mx-auto mt-10 min-h-0 w-full max-w-[46rem] flex-1" />

        <DiagramLegend />
      </section>

      {/* --- 폼 ------------------------------------------------------ */}
      <main className="flex flex-1 flex-col bg-surface-page px-5 py-10 sm:px-8 lg:w-[33rem] lg:flex-none lg:px-14 lg:py-14">
        <div className="mx-auto flex w-full max-w-form flex-1 flex-col justify-center">
          {children}
        </div>

        <footer className="mx-auto mt-10 w-full max-w-form text-caption text-content-tertiary">
          <p>
            이 시스템의 접속 기록은 보안 감사를 위해 보관됩니다. 계정은 개인에게만
            발급되며 공유할 수 없습니다.
          </p>
        </footer>
      </main>
    </div>
  );
}

/** 1024px 아래에서 레일을 대신하는 상단 바 */
function TopBar() {
  return (
    <header className="flex h-14 items-center gap-3 bg-canvas-900 px-5 lg:hidden">
      <NtmsMark size={24} className="text-canvas-100" />
      <span className="text-title-sm font-semibold tracking-[-0.01em] text-canvas-50">
        NTMS
      </span>
      <span className="eyebrow-ko ml-auto text-canvas-400">운송관리시스템</span>
    </header>
  );
}

/** 세로 레일. 로그인 이후에도 같은 자리에 남는 제품의 척추 */
function Rail() {
  return (
    <aside className="hidden w-[76px] shrink-0 flex-col items-center justify-between bg-canvas-900 py-6 lg:flex">
      <NtmsMark size={28} className="text-canvas-100" />

      {/* canvas-500/600 은 잉크 배경에서 4.5:1 을 넘지 못한다.
          작아서 눈에 덜 띄어야 하는 글자일수록 색이 아니라 크기로 낮춘다. */}
      <p
        className="eyebrow text-canvas-400"
        style={{ writingMode: 'vertical-rl' }}
      >
        NTMS Transport Management
      </p>

      <div className="flex flex-col items-center gap-3">
        {/* 눈금 세 칸. 마크 · 레일 · 다이어그램이 같은 눈금 언어를 쓴다 */}
        <span aria-hidden="true" className="flex flex-col items-center gap-1.5">
          <span className="h-px w-4 bg-canvas-700" />
          <span className="h-px w-2.5 bg-canvas-700" />
          <span className="h-px w-4 bg-canvas-700" />
        </span>
        <span className="tabular text-[10px] text-canvas-400">v0.1</span>
      </div>
    </aside>
  );
}

/** 다이어그램은 범례 없이는 그림에 그친다 */
function DiagramLegend() {
  return (
    <div
      className="animate-rise mt-8 flex flex-wrap items-center gap-x-6 gap-y-2"
      style={{ animationDelay: '2400ms' }}
    >
      <LegendItem>
        <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true">
          <path
            d="M1 9 L21 1"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="text-canvas-400"
          />
        </svg>
        이동
      </LegendItem>

      <LegendItem>
        <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true">
          <path
            d="M1 5h20"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="text-canvas-400"
          />
        </svg>
        정차
      </LegendItem>

      <LegendItem>
        <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true">
          <path
            d="M1 8 L21 2"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="text-jade-400"
          />
        </svg>
        진행 중인 운행
      </LegendItem>

      <span className="eyebrow-ko ml-auto text-canvas-400">예시 데이터</span>
    </div>
  );
}

function LegendItem({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-center gap-2 text-caption text-canvas-400">
      {children}
    </span>
  );
}
