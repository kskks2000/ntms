import { HttpException, HttpStatus } from '@nestjs/common';
import type { ZodError } from 'zod';

/**
 * 이 저장소의 모든 오류 응답은 @ntms/shared 의 ApiError 형태 하나로 나간다.
 *
 * Nest 기본 예외는 { statusCode, message, error } 를 내보내는데, 화면 쪽에서
 * message 문자열을 파싱해 분기하는 코드가 생기기 쉽다. 문구가 바뀌면 조용히
 * 깨진다. 그래서 기계가 읽는 code 와 사람이 읽는 message 를 분리한다.
 */
export class AppError extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    readonly detail?: Record<string, unknown>,
    readonly fields?: Record<string, string[]>,
  ) {
    super({ code, message, detail, fields }, status);
  }

  static badRequest(code: string, message: string, detail?: Record<string, unknown>) {
    return new AppError(HttpStatus.BAD_REQUEST, code, message, detail);
  }

  static unauthorized(code: string, message: string, detail?: Record<string, unknown>) {
    return new AppError(HttpStatus.UNAUTHORIZED, code, message, detail);
  }

  static forbidden(code: string, message: string, detail?: Record<string, unknown>) {
    return new AppError(HttpStatus.FORBIDDEN, code, message, detail);
  }

  static notFound(code: string, message: string) {
    return new AppError(HttpStatus.NOT_FOUND, code, message);
  }

  static conflict(code: string, message: string, detail?: Record<string, unknown>) {
    return new AppError(HttpStatus.CONFLICT, code, message, detail);
  }
}

/** zod 오류를 필드별 메시지로 접는다. 화면 폼이 그대로 필드에 매달 수 있는 형태다. */
export function zodFields(error: ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

export function validationError(error: ZodError): AppError {
  return new AppError(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'VALIDATION_FAILED',
    '입력값을 확인해 주세요.',
    undefined,
    zodFields(error),
  );
}
