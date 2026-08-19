import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';

/**
 * 비밀번호 해시. user_account.password_algo 의 기본값이 argon2id 다.
 *
 * 파라미터는 OWASP 권장값(m=19MiB, t=2, p=1)을 따른다. 값을 올리면 로그인
 * 지연이 그만큼 늘어난다. 바꿀 때는 반드시 실측하고, 기존 해시는 그대로
 * 검증되므로(파라미터가 해시 문자열 안에 들어 있다) 점진 교체가 가능하다.
 *
 * @node-rs/argon2 의 Algorithm 은 ambient const enum 이라 isolatedModules
 * 환경에서 값으로 가져올 수 없다. 2 = Argon2id (0=Argon2d, 1=Argon2i).
 */
const ARGON2ID = 2;

const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService implements OnModuleInit {
  private readonly logger = new Logger(PasswordService.name);

  readonly algo = 'argon2id';

  /**
   * 계정이 없을 때 비교용으로 쓰는 더미 해시.
   *
   * 계정이 없다고 즉시 응답하면 응답 시간만으로 "이 아이디는 존재한다" 를
   * 알아낼 수 있다(사용자 열거). 계정이 없어도 같은 비용의 검증을 한 번
   * 돌려 시간 차이를 지운다. 기동 시 한 번 만들어 두고 재사용한다.
   */
  private dummyHash = '';

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hash(randomBytes(32).toString('hex'), ARGON2_OPTIONS);
  }

  async hash(plain: string): Promise<string> {
    return hash(plain, ARGON2_OPTIONS);
  }

  async verify(storedHash: string | null, plain: string): Promise<boolean> {
    if (!storedHash) {
      await this.burnTime();
      return false;
    }
    try {
      return await verify(storedHash, plain, ARGON2_OPTIONS);
    } catch (error) {
      // 해시 형식이 깨졌거나 다른 알고리즘으로 저장된 경우.
      // 실패로 처리하되, 데이터 문제이므로 흔적을 남긴다.
      this.logger.warn(`비밀번호 해시를 검증할 수 없습니다: ${(error as Error).message}`);
      return false;
    }
  }

  /** 계정이 없을 때도 검증과 같은 시간을 쓰게 한다 */
  async burnTime(): Promise<void> {
    if (!this.dummyHash) return;
    await verify(this.dummyHash, 'not-a-real-password', ARGON2_OPTIONS).catch(
      () => false,
    );
  }
}
