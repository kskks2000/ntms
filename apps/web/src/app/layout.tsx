import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans_KR } from 'next/font/google';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth-context';
import { QueryProvider } from '@/lib/query';
import { ToastProvider } from '@/components/ui/toast';
import './globals.css';

/**
 * 두 목소리로 쓴다.
 *
 *   Plex Sans KR — 사람이 읽는 것. 문장 · 라벨 · 제목.
 *   Plex Mono    — 기계가 세는 것. 오더번호 · 시각 · 수량 · 눈금.
 *
 * 같은 집안(IBM Plex)이라 나란히 놓아도 어긋나지 않으면서, 성격은 뚜렷이
 * 갈린다. 하루 종일 표를 들여다보는 화면에서 "이 값은 자릿수가 맞아야 하는
 * 값" 이라는 신호를 서체가 대신 준다.
 *
 * next/font 가 빌드 시점에 받아 같은 도메인에서 서빙한다. 사내망에서
 * 외부 폰트 CDN 이 막혀 있어도 글자가 깨지지 않는다.
 *
 * subsets 에 'korean' 을 넣지 않은 것은 의도적이다. 한글은 유니코드 구간이
 * 100개 넘게 쪼개져 있어서 preload 를 걸면 첫 화면에서 그 파일을 전부
 * 받으려 든다. 구간은 그대로 자체 호스팅되고, 브라우저가 실제로 쓰는 것만
 * 골라 받는다. 그동안은 display:swap 이 대체 서체로 글자를 보여준다.
 */
const sans = IBM_Plex_Sans_KR({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
  fallback: ['Pretendard', 'Malgun Gothic', 'sans-serif'],
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
  fallback: ['ui-monospace', 'monospace'],
});

export const metadata: Metadata = {
  title: {
    default: 'NTMS 통합 연계 운송관리시스템',
    template: '%s · NTMS',
  },
  description: '운송오더 · 편성 · 배차 · 실행 · 실적 · 정산',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // maximumScale 을 막지 않는다. 확대를 봉인하면 저시력 사용자가 화면을 못 읽는다.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f8f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0b161b' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <QueryProvider>
          <AuthProvider>
            <ToastProvider>{children}</ToastProvider>
          </AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
