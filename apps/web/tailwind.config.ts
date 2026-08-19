import type { Config } from 'tailwindcss';

/**
 * 유틸리티는 의미 토큰만 노출한다.
 *
 * bg-ink-850 같은 원시 토큰을 유틸리티로 열어 두면 화면 코드가 그것을 쓰기
 * 시작하고, 그 순간 다크모드가 그 자리에서 깨진다. 원시 토큰이 필요한 곳은
 * 브랜드 표면(관제 캔버스) 한 곳뿐이라 canvas- 접두어로 따로 묶어 두었다.
 */
const rgb = (token: string) => `rgb(var(${token}) / <alpha-value>)`;

export default {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        surface: {
          page: rgb('--surface-page'),
          card: rgb('--surface-card'),
          sunken: rgb('--surface-sunken'),
          field: rgb('--surface-field'),
        },
        line: {
          subtle: rgb('--border-subtle'),
          strong: rgb('--border-strong'),
          field: rgb('--border-field'),
        },
        content: {
          primary: rgb('--text-primary'),
          secondary: rgb('--text-secondary'),
          tertiary: rgb('--text-tertiary'),
          inverse: rgb('--text-inverse'),
          accent: rgb('--text-accent'),
        },
        accent: {
          DEFAULT: rgb('--accent'),
          quiet: rgb('--accent-quiet'),
        },
        action: {
          DEFAULT: rgb('--action-primary'),
          hover: rgb('--action-primary-hover'),
          active: rgb('--action-primary-active'),
          text: rgb('--action-primary-text'),
        },
        status: {
          warning: rgb('--status-warning'),
          danger: rgb('--status-danger'),
          success: rgb('--status-success'),
          'warning-surface': rgb('--status-warning-surface'),
          'danger-surface': rgb('--status-danger-surface'),
          'success-surface': rgb('--status-success-surface'),
        },
        // 브랜드 표면. 라이트/다크와 무관하게 항상 잉크색이다.
        canvas: {
          950: rgb('--c-ink-950'),
          900: rgb('--c-ink-900'),
          850: rgb('--c-ink-850'),
          800: rgb('--c-ink-800'),
          700: rgb('--c-ink-700'),
          600: rgb('--c-ink-600'),
          500: rgb('--c-ink-500'),
          400: rgb('--c-ink-400'),
          300: rgb('--c-ink-300'),
          200: rgb('--c-ink-200'),
          100: rgb('--c-ink-100'),
          50: rgb('--c-ink-50'),
        },
        jade: {
          800: rgb('--c-jade-800'),
          700: rgb('--c-jade-700'),
          600: rgb('--c-jade-600'),
          500: rgb('--c-jade-500'),
          400: rgb('--c-jade-400'),
          300: rgb('--c-jade-300'),
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Pretendard', 'Segoe UI', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // 12 / 13 / 15 / 16 / 18 / 22 / 28 / 40 — 8단계로 끝낸다
        caption: ['0.75rem', { lineHeight: '1.45' }],
        label: ['0.8125rem', { lineHeight: '1.4' }],
        body: ['0.9375rem', { lineHeight: '1.6' }],
        lead: ['1rem', { lineHeight: '1.6' }],
        'title-sm': ['1.125rem', { lineHeight: '1.45', letterSpacing: '-0.01em' }],
        title: ['1.375rem', { lineHeight: '1.35', letterSpacing: '-0.014em' }],
        'display-sm': ['1.75rem', { lineHeight: '1.25', letterSpacing: '-0.018em' }],
        display: ['2.5rem', { lineHeight: '1.14', letterSpacing: '-0.024em' }],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        card: 'var(--radius-card)',
      },
      boxShadow: {
        // 잉크색을 섞은 그림자. 순수 검정 그림자는 이 팔레트에서 탁해 보인다.
        sm: '0 1px 2px rgb(10 23 29 / 0.06)',
        md: '0 1px 2px rgb(10 23 29 / 0.05), 0 8px 20px -10px rgb(10 23 29 / 0.14)',
        lg: '0 1px 2px rgb(10 23 29 / 0.06), 0 18px 44px -18px rgb(10 23 29 / 0.24)',
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
        in: 'var(--ease-in)',
      },
      transitionDuration: {
        fast: '120ms',
        base: '200ms',
        slow: '320ms',
      },
      maxWidth: {
        form: '25rem',
      },
    },
  },
  plugins: [],
} satisfies Config;
