import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';
import { validationError } from './api-error.js';

/**
 * @ntms/shared 의 zod 스키마로 요청 본문/쿼리를 검증한다.
 *
 * 전역 ValidationPipe 를 쓰지 않는 이유는 main.ts 에 적어 두었다 —
 * 검증 규칙은 API 와 Web 이 같은 스키마 한 벌을 공유하고, 그 스키마는
 * class-validator 데코레이터가 아니라 zod 다.
 *
 * @example
 * @Post('login')
 * login(@Body(new ZodValidationPipe(loginSchema)) dto: LoginInput) {}
 */
@Injectable()
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw validationError(result.error);
    }
    return result.data;
  }
}
