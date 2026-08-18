import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Docker healthcheck 전용. Nest API 상태와 무관하게 웹 프로세스만 판정한다. */
export function GET() {
  return NextResponse.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
  });
}
