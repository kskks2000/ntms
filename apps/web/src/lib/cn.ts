import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge 는 text-* 를 만나면 크기인지 색인지 이름으로 판단한다.
 * 기본 목록(text-sm, text-lg …)에 없는 이름은 색으로 본다.
 *
 * 그래서 이 저장소의 text-body / text-lead 같은 자체 크기 토큰이 색으로
 * 분류되고, 같은 요소에 붙은 진짜 색(text-action-text)을 "같은 그룹의
 * 중복" 이라며 지워 버린다. 검은 버튼 위 흰 글자가 상속색(거의 검정)으로
 * 돌아가 글자가 통째로 사라지는 식으로 드러난다.
 *
 * 크기 토큰을 font-size 그룹에 등록해서 그 오판을 막는다.
 * tailwind.config.ts 의 fontSize 에 항목을 추가하면 여기에도 같이 넣을 것.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'caption',
            'label',
            'body',
            'lead',
            'title-sm',
            'title',
            'display-sm',
            'display',
          ],
        },
      ],
    },
  },
});

/**
 * 조건부 클래스 합성 + Tailwind 충돌 정리.
 * px-4 를 준 컴포넌트에 px-6 을 넘기면 뒤에 온 쪽이 이긴다.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
