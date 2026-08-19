'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  AuthUser,
  ChangePasswordInput,
  LoginInput,
  LoginResult,
  MenuNode,
} from '@ntms/shared';
import { ApiRequestError, apiFetch } from './api-client';

/**
 * 액세스 토큰은 **메모리에만** 둔다.
 *
 * localStorage 에 넣으면 XSS 한 번에 토큰이 통째로 새어 나간다. 새로고침하면
 * 사라지지만, 그때는 httpOnly 리프레시 쿠키로 조용히 다시 받아온다.
 * 이 교환이 "새로고침해도 로그인이 풀리지 않는다" 의 실제 구현이다.
 */
interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  /**
   * 이 사용자가 볼 수 있는 메뉴. 서버가 역할로 걸러 내려준다.
   * 화면 구성이 코드가 아니라 데이터에서 오므로, 권한을 바꾸면 배포 없이 바뀐다.
   */
  menus: MenuNode[];
  /** 첫 세션 복구가 끝났는가. 끝나기 전에는 화면을 판단하면 안 된다 */
  ready: boolean;
  login: (input: LoginInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<AuthUser | null>;
  changePassword: (input: ChangePasswordInput) => Promise<AuthUser>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [menus, setMenus] = useState<MenuNode[]>([]);
  const [ready, setReady] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 예약된 갱신이 최신 함수를 부르게 하는 우회로.
  // applySession 이 silentRefresh 를 부르고 silentRefresh 가 applySession 을
  // 부르는 순환이라, 둘 중 하나는 참조로 끊어야 한다.
  const silentRefreshRef = useRef<(() => Promise<AuthUser | null>) | null>(null);

  const applySession = useCallback((result: LoginResult) => {
    setUser(result.user);
    setAccessToken(result.accessToken);

    // 만료 1분 전에 미리 갱신한다. 사용자가 저장 버튼을 누르는 순간
    // 토큰이 죽어 있는 상황을 피하려는 것이다.
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    const delay = Math.max((result.expiresIn - 60) * 1000, 30_000);
    refreshTimer.current = setTimeout(() => {
      void silentRefreshRef.current?.();
    }, delay);
  }, []);

  /**
   * 메뉴는 세션이 생길 때마다 다시 읽는다.
   * 관리자가 권한을 바꿨다면 다음 갱신에서 바로 반영되어야 한다.
   */
  const loadMenus = useCallback(async (token: string) => {
    try {
      setMenus(await apiFetch<MenuNode[]>('/auth/menus', { accessToken: token }));
    } catch {
      // 메뉴를 못 읽어도 로그인은 유효하다. 빈 내비게이션으로 두고
      // 화면 자체는 열어 준다 — 여기서 막으면 아무것도 할 수 없게 된다.
      setMenus([]);
    }
  }, []);

  const silentRefresh = useCallback(async (): Promise<AuthUser | null> => {
    try {
      const result = await apiFetch<LoginResult>('/auth/refresh', {
        method: 'POST',
      });
      applySession(result);
      void loadMenus(result.accessToken);
      return result.user;
    } catch {
      setUser(null);
      setAccessToken(null);
      setMenus([]);
      return null;
    }
  }, [applySession, loadMenus]);

  useEffect(() => {
    silentRefreshRef.current = silentRefresh;
  }, [silentRefresh]);

  useEffect(() => {
    void silentRefresh().finally(() => setReady(true));
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [silentRefresh]);

  const login = useCallback(
    async (input: LoginInput) => {
      const result = await apiFetch<LoginResult>('/auth/login', {
        method: 'POST',
        body: input,
      });
      applySession(result);
      await loadMenus(result.accessToken);
      return result.user;
    },
    [applySession, loadMenus],
  );

  const logout = useCallback(async () => {
    try {
      await apiFetch<void>('/auth/logout', { method: 'POST' });
    } catch (error) {
      // 서버가 못 받아도 이 브라우저에서는 반드시 나가야 한다
      if (!(error instanceof ApiRequestError)) throw error;
    } finally {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      setUser(null);
      setAccessToken(null);
      setMenus([]);
    }
  }, []);

  /**
   * 비밀번호 변경. 서버가 이 세션은 남기고 다른 기기만 끊으므로
   * 토큰을 다시 받을 필요가 없다. 돌아온 사용자 정보만 갈아 끼운다.
   */
  const changePassword = useCallback(
    async (input: ChangePasswordInput) => {
      const updated = await apiFetch<AuthUser>('/auth/password', {
        method: 'POST',
        body: input,
        accessToken,
      });
      setUser(updated);
      return updated;
    },
    [accessToken],
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      accessToken,
      menus,
      ready,
      login,
      logout,
      refresh: silentRefresh,
      changePassword,
    }),
    [user, accessToken, menus, ready, login, logout, silentRefresh, changePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth 는 AuthProvider 안에서만 사용할 수 있습니다');
  }
  return ctx;
}
