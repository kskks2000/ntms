import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.use(helmet());
  app.use(cookieParser());

  // nginx 뒤에 있으므로 X-Forwarded-* 를 신뢰해야 실제 클라이언트 IP 를 얻는다.
  // 감사로그의 client_ip 가 여기에 달려 있다.
  app.set('trust proxy', 1);

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? true,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );

  // 종료 신호를 받으면 진행 중 요청을 마치고 커넥션을 정리한다
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`NTMS API listening on :${port}`);
}

void bootstrap();
