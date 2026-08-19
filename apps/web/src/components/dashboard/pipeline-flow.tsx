'use client';

import Link from 'next/link';
import type { PipelineNode } from '@ntms/shared';

/**
 * 운송 파이프라인.
 *
 * TMS 의 하루는 한 줄로 흐른다 —
 *   접수 → 편성 → 배정 → 배차 → 운송 → 실적 → 정산
 *
 * 배차 담당자가 아침에 알아야 하는 것은 "몇 건 처리했나" 가 아니라
 * "지금 어디에 얼마나 쌓여 있나" 다. 그래서 축 하나에 두 가지를 겹쳐 그린다.
 *
 *   **축 위로 흐르고, 축 아래로 쌓인다.**
 *
 *   · 마디를 잇는 선의 두께 = 그 단계로 넘어간 오더 수 (흐름)
 *   · 축 아래로 내려간 막대 = 그 단계에 머무는 오더 수 (정체)
 *
 * 선이 가늘어지는 곳에서 일이 멈추고, 막대가 길어지는 곳에 일이 고인다.
 * 두 신호가 같은 자리에서 만나면 그곳이 오늘의 병목이다.
 *
 * 로그인 화면의 운행 다이어그램과 같은 언어(축 · 마디 · 눈금)를 쓴다.
 * 처음 본 그림이 앱 안에서 계속 이어지게 하려는 것이다.
 */

const VIEW_W = 1120;
const VIEW_H = 300;
const PAD_X = 74;
const AXIS_Y = 132;
const MAX_BAR = 96;

/** 흐름선 두께 — 건수를 2~11px 로 옮긴다 */
function strokeFor(count: number, max: number): number {
  if (max <= 0) return 2;
  return 2 + (count / max) * 9;
}

export function PipelineFlow({ nodes }: { nodes: PipelineNode[] }) {
  if (nodes.length === 0) return null;

  const step = (VIEW_W - PAD_X * 2) / (nodes.length - 1);
  const x = (i: number) => PAD_X + i * step;

  const maxPassed = Math.max(...nodes.map((n) => n.passed), 1);
  const maxBacklog = Math.max(...nodes.map((n) => n.backlog), 1);

  const barHeight = (n: number) => (n === 0 ? 0 : 10 + (n / maxBacklog) * MAX_BAR);

  return (
    <figure className="min-w-0">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full"
        role="img"
        aria-label={
          '운송 파이프라인. ' +
          nodes
            .map((n) => `${n.label} 통과 ${n.passed}건, ${n.backlogLabel} ${n.backlog}건`)
            .join('. ')
        }
      >
        {/* --- 흐름 : 마디를 잇는 선. 넘어간 건수만큼 굵다 --------------- */}
        <g aria-hidden="true" strokeLinecap="round">
          {nodes.slice(0, -1).map((_, i) => {
            const next = nodes[i + 1]!;
            return (
              <line
                key={`seg-${i}`}
                x1={x(i)}
                y1={AXIS_Y}
                x2={x(i + 1)}
                y2={AXIS_Y}
                stroke="currentColor"
                strokeWidth={strokeFor(next.passed, maxPassed)}
                className="text-canvas-600"
              />
            );
          })}
        </g>

        {/* --- 마디와 숫자 --------------------------------------------- */}
        {nodes.map((node, i) => {
          const cx = x(i);
          const height = barHeight(node.backlog);

          // 운송 단계에 머무는 것은 정체가 아니라 진행이다. 도로 위에 있는
          // 차를 병목으로 칠하면 매일 빨간 화면을 보게 된다.
          const isMoving = node.stage === 'TRANSIT';
          const barClass = isMoving
            ? 'text-jade-400'
            : node.isBottleneck
              ? 'text-amber-300'
              : 'text-canvas-500';
          const backlogTextClass = isMoving
            ? 'fill-jade-300'
            : node.isBottleneck
              ? 'fill-amber-300'
              : 'fill-canvas-300';

          return (
            <Link
              key={node.stage}
              href={node.href}
              aria-label={`${node.label} — 통과 ${node.passed}건, ${node.backlogLabel} ${node.backlog}건. 해당 화면으로 이동`}
              className="group animate-rise"
              style={{ animationDelay: `${80 + i * 55}ms` }}
            >
              {/* 마디 한 칸 전체가 누를 수 있는 영역이다 */}
              <rect
                x={cx - step / 2 + 5}
                y={16}
                width={step - 10}
                height={VIEW_H - 32}
                rx="12"
                fill="currentColor"
                className="text-canvas-100 opacity-0 transition-opacity duration-base ease-out group-hover:opacity-[0.07]"
              />

              {/* 통과 건수 — 축 위 */}
              <text
                x={cx}
                y={AXIS_Y - 54}
                textAnchor="middle"
                className="fill-canvas-50 font-mono text-[26px] font-medium"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {node.passed}
              </text>
              <text
                x={cx}
                y={AXIS_Y - 30}
                textAnchor="middle"
                className="fill-canvas-300 font-sans text-[15px]"
              >
                {node.label}
              </text>

              {/* 마디 */}
              <circle cx={cx} cy={AXIS_Y} r="6.5" className="fill-canvas-850" />
              <circle
                cx={cx}
                cy={AXIS_Y}
                r="6.5"
                fill="none"
                strokeWidth="2.5"
                stroke="currentColor"
                className={node.isBottleneck ? 'text-amber-300' : 'text-canvas-100'}
              />

              {/* 정체 — 축 아래로 내려간 막대 */}
              {node.backlog > 0 && (
                <>
                  <rect
                    x={cx - 7}
                    y={AXIS_Y + 8}
                    width="14"
                    height={height}
                    rx="7"
                    fill="currentColor"
                    className={barClass}
                    style={{
                      transformOrigin: `${cx}px ${AXIS_Y + 8}px`,
                      animation: `ntms-grow 520ms var(--ease-out) ${260 + i * 55}ms both`,
                    }}
                  />
                  <text
                    x={cx}
                    y={AXIS_Y + 8 + height + 26}
                    textAnchor="middle"
                    className={`${backlogTextClass} font-mono text-[19px] font-medium`}
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {node.backlog}
                  </text>
                  <text
                    x={cx}
                    y={AXIS_Y + 8 + height + 45}
                    textAnchor="middle"
                    className="fill-canvas-400 font-sans text-[13px]"
                  >
                    {node.backlogLabel}
                  </text>
                </>
              )}

            </Link>
          );
        })}
      </svg>

      <figcaption className="sr-only">
        축 위의 숫자는 그 단계를 통과한 오더 수, 축 아래로 내려간 막대는 그 단계에
        머물러 있는 오더 수입니다. 선이 굵을수록 많이 넘어갔고, 막대가 길수록 많이
        쌓여 있습니다.
      </figcaption>
    </figure>
  );
}
