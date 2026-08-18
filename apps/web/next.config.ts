import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Docker 이미지를 가볍게 하고 기동을 빠르게 한다.
  // Dockerfile.web 이 .next/standalone 을 그대로 복사하므로 필수.
  output: 'standalone',

  // 모노레포 루트를 기준으로 파일 추적 (standalone 출력이 워크스페이스
  // 패키지를 빠뜨리지 않도록)
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,

  // 워크스페이스 패키지는 Next 가 직접 트랜스파일한다
  transpilePackages: ['@ntms/shared'],

  reactStrictMode: true,
  poweredByHeader: false,

  eslint: {
    // 빌드는 타입 검사에 집중하고, 린트는 CI 단계에서 별도로 돌린다
    ignoreDuringBuilds: true,
  },

  async rewrites() {
    // 개발 중에는 Next 가 /api 를 Nest 로 프록시한다.
    // 배포 환경에서는 nginx 가 처리하므로 이 경로를 타지 않는다.
    const apiUrl = process.env.INTERNAL_API_URL ?? 'http://localhost:4000';
    return [
      {
        source: '/api/:path((?!health).*)',
        destination: `${apiUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
