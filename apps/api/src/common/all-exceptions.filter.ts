import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { ApiError } from '@ntms/shared';
import { AUTH_ERROR } from '@ntms/shared';

/**
 * 모든 예외를 ApiError 한 가지 형태로 내보낸다.
 *
 * traceId 를 함께 내보내는 이유: 사용자가 "오류가 났다" 고 말할 때 화면에
 * 찍힌 이 값으로 서버 로그를 바로 찾을 수 있다. 그 대신 내부 메시지는
 * 절대 밖으로 내보내지 않는다 — 500 의 본문은 항상 같은 문구다.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const traceId = randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ApiError = {
      code: 'INTERNAL_ERROR',
      message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      traceId,
    };

    if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      body = {
        code: AUTH_ERROR.TOO_MANY_ATTEMPTS,
        message: '시도가 너무 잦습니다. 잠시 후 다시 해 주세요.',
        traceId,
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'object' && payload !== null && 'code' in payload) {
        const p = payload as Record<string, unknown>;
        body = {
          code: String(p.code),
          message: String(p.message ?? '요청을 처리하지 못했습니다.'),
          traceId,
        };
        if (p.fields) body.fields = p.fields as Record<string, string[]>;
        if (p.detail) body.detail = p.detail as Record<string, unknown>;
      } else {
        body = {
          code: httpStatusCode(status),
          message:
            typeof payload === 'string' ? payload : exception.message,
          traceId,
        };
      }
    }

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl} → ${status} traceId=${traceId}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `${req.method} ${req.originalUrl} → ${status} ${body.code} traceId=${traceId}`,
      );
    }

    res.status(status).json(body);
  }
}

function httpStatusCode(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'BAD_REQUEST';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHORIZED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    default:
      return 'HTTP_ERROR';
  }
}
