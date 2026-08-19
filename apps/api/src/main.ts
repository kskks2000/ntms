import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  // Express 어댑터 타입으로 만들어야 set('trust proxy') 를 쓸 수 있다
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  app.use(helmet());
  app.use(cookieParser());

  // nginx 뒤에 있으므로 X-Forwarded-* 를 신뢰해야 실제 클라이언트 IP 를 얻는다.
  // 감사로그의 client_ip 가 여기에 달려 있다.
  app.set('trust proxy', 1);

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? true,
    credentials: true,
  });

  // 전역 파이프는 두지 않는다. Nest 기본 ValidationPipe 는 class-validator
  // 데코레이터를 전제로 하는데, 이 저장소의 검증 규칙은 @ntms/shared 의 zod
  // 스키마 한 벌로 API 와 Web 이 공유한다. 도메인 모듈을 붙일 때 그 스키마를
  // 감싸는 ZodValidationPipe 를 라우트 단위로 건다.

  // 종료 신호를 받으면 진행 중 요청을 마치고 커넥션을 정리한다
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`NTMS API listening on :${port}`);
}

void bootstrap();
