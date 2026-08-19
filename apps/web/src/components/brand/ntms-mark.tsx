/**
 * NTMS 마크.
 *
 * 하나의 시간 축(세로 눈금) 위에 상차 · 경유 · 하차 세 지점이 놓인 모습.
 * 이 제품이 하는 일 — 계획과 실행을 같은 축 위에 세워 차이를 남기는 것 —
 * 을 도형 하나로 줄인 것이고, 관제 캔버스의 운행 다이어그램과 같은 언어다.
 */
export function NtmsMark({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      role="img"
      aria-label="NTMS"
      className={className}
    >
      {/* 시간 축 */}
      <path
        d="M4 3.5v21"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.45"
      />
      {/* 눈금 */}
      <path
        d="M4 7h2.5M4 14h2.5M4 21h2.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        opacity="0.45"
      />
      {/* 운행선 : 상차 → 경유(정차) → 하차 */}
      <path
        d="M9 21h4l6-7h5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 현재 지점 */}
      <circle cx="24" cy="14" r="2.5" fill="currentColor" />
    </svg>
  );
}

/** 잉크 표면 위의 워드마크 */
export function NtmsWordmark({ className }: { className?: string }) {
  return (
    <span className={className}>
      <span className="font-semibold tracking-[-0.01em]">NTMS</span>
    </span>
  );
}
