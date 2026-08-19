import { redirect } from 'next/navigation';

/**
 * 루트에 머무는 화면은 없다. 인증 상태에 따라 갈리는 판단은
 * /dashboard 한 곳에서만 한다.
 */
export default function HomePage() {
  redirect('/dashboard');
}
