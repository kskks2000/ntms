'use client';

import { MapPinOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useApiQuery } from '@/lib/query';
import { cn } from '@/lib/cn';

/**
 * 네이버 지도.
 *
 * ## 키가 없어도 앱은 뜬다
 *
 * 지도는 외부 서비스에 기대는 유일한 화면 요소다. 키를 안 넣었거나 NCP
 * 쪽에 문제가 있어도 **여기만 안내 문구로 바뀌고 나머지는 그대로** 돌아야
 * 한다. 지도 하나 때문에 배차판이 통째로 하얘지는 것이 훨씬 나쁘다.
 *
 * ## SDK 를 한 번만 받는다
 *
 * 스크립트를 컴포넌트마다 넣으면 지도를 두 개 띄울 때 두 번 받고, 두
 * 번째에서 전역 `naver` 가 덮어써지며 첫 지도가 죽는다. 모듈 수준에서
 * 하나의 약속(Promise)을 공유한다.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Window { naver?: any }
}

interface MapConfig {
  enabled: boolean;
  clientId: string | null;
  serverReady: boolean;
}

export interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  /** 마커 위에 찍히는 짧은 글자. 정차 순번 같은 것 */
  label?: string;
  title?: string;
  tone?: 'pickup' | 'delivery' | 'vehicle';
}

/** [경도, 위도] 쌍 — 네이버 Directions 가 주는 순서 그대로 */
export type MapPath = [number, number][];

let sdkPromise: Promise<void> | null = null;

function loadSdk(clientId: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.naver?.maps) return Promise.resolve();
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    // ncpKeyId 는 신 인증 방식이다. 예전 ncpClientId 로 발급받았다면
    // 파라미터 이름을 바꿔야 한다.
    el.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId)}`;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      sdkPromise = null;
      reject(new Error('지도 스크립트를 받지 못했습니다'));
    };
    document.head.appendChild(el);
  });
  return sdkPromise;
}

const TONE_COLOR = {
  pickup: '#0f766e',
  delivery: '#64748b',
  vehicle: '#b45309',
} as const;

export function NaverMap({
  markers = [],
  path,
  className,
  height = 360,
  /** 지도가 안 뜰 때 자리에 보일 설명. 화면마다 다르다 */
  fallbackHint,
}: {
  markers?: MapMarker[];
  path?: MapPath;
  className?: string;
  height?: number;
  fallbackHint?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drawnRef = useRef<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const config = useApiQuery<MapConfig>(['naver-config'], '/naver/config', {
    staleTime: 30 * 60_000,
  });
  const clientId = config.data?.clientId ?? null;

  // 지도를 한 번 만든다
  useEffect(() => {
    if (!clientId || !boxRef.current || mapRef.current) return;
    let cancelled = false;

    loadSdk(clientId)
      .then(() => {
        if (cancelled || !boxRef.current || !window.naver?.maps) return;
        mapRef.current = new window.naver.maps.Map(boxRef.current, {
          // 대한민국 중앙쯤. 마커가 붙으면 곧바로 그쪽으로 옮긴다.
          center: new window.naver.maps.LatLng(36.5, 127.8),
          zoom: 7,
          logoControl: true,
          mapDataControl: false,
          scaleControl: true,
        });
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setError('지도를 불러오지 못했습니다');
      });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  // 마커와 경로를 다시 그린다
  useEffect(() => {
    const maps = window.naver?.maps;
    const map = mapRef.current;
    if (!ready || !maps || !map) return;

    // 이전에 그린 것을 걷어낸다. 안 걷으면 갱신할 때마다 겹쳐 쌓인다.
    for (const item of drawnRef.current) item.setMap(null);
    drawnRef.current = [];

    const bounds = new maps.LatLngBounds();
    let any = false;

    for (const m of markers) {
      if (!Number.isFinite(m.latitude) || !Number.isFinite(m.longitude)) continue;
      const pos = new maps.LatLng(m.latitude, m.longitude);
      const color = TONE_COLOR[m.tone ?? 'pickup'];
      const marker = new maps.Marker({
        position: pos,
        map,
        title: m.title ?? m.label,
        icon: {
          content: `<div style="
            display:flex;align-items:center;justify-content:center;
            width:22px;height:22px;border-radius:11px;
            background:${color};color:#fff;
            font:600 11px/1 'IBM Plex Mono',monospace;
            box-shadow:0 1px 3px rgba(0,0,0,.35)">${m.label ?? ''}</div>`,
          anchor: new maps.Point(11, 11),
        },
      });
      drawnRef.current.push(marker);
      bounds.extend(pos);
      any = true;
    }

    if (path && path.length > 1) {
      const line = new maps.Polyline({
        map,
        path: path.map(([lng, lat]) => new maps.LatLng(lat, lng)),
        strokeColor: '#0f766e',
        strokeWeight: 4,
        strokeOpacity: 0.75,
      });
      drawnRef.current.push(line);
      for (const [lng, lat] of path) {
        bounds.extend(new maps.LatLng(lat, lng));
        any = true;
      }
    }

    if (any) map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
  }, [ready, markers, path]);

  if (config.isLoading) {
    return <Placeholder height={height} className={className}>지도를 준비하는 중…</Placeholder>;
  }

  if (!clientId) {
    return (
      <Placeholder height={height} className={className} icon>
        <span className="font-medium text-content-secondary">지도 키가 설정되지 않았습니다</span>
        <span className="mt-1 block">
          {fallbackHint ??
            '서버 .env 에 NAVER_MAPS_CLIENT_ID 를 넣으면 여기에 지도가 나옵니다.'}
        </span>
      </Placeholder>
    );
  }

  if (error) {
    return (
      <Placeholder height={height} className={className} icon>
        <span className="font-medium text-content-secondary">{error}</span>
        <span className="mt-1 block">
          NCP 콘솔의 Application 에 이 도메인이 등록돼 있는지 확인하세요.
        </span>
      </Placeholder>
    );
  }

  return (
    <div
      ref={boxRef}
      style={{ height }}
      className={cn('w-full overflow-hidden rounded-card bg-surface-sunken', className)}
    />
  );
}

function Placeholder({
  height,
  className,
  icon,
  children,
}: {
  height: number;
  className?: string;
  icon?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{ height }}
      className={cn(
        'flex w-full flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line-strong bg-surface-sunken px-6 text-center text-caption text-content-tertiary',
        className,
      )}
    >
      {icon && <MapPinOff size={22} strokeWidth={1.5} aria-hidden="true" />}
      <p className="max-w-sm">{children}</p>
    </div>
  );
}
