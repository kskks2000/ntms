/**
 * 메뉴 트리.
 *
 * 화면에 무엇이 보이는지는 코드에 박아 두지 않는다. `ntms.menu` 와
 * `ntms.role_menu` 가 정본이고, 서버가 그 사람의 역할로 걸러서 내려준다.
 * 테넌트마다 쓰는 모듈이 다르고, 같은 테넌트 안에서도 배차담당자와
 * 정산담당자가 보는 것이 달라야 하기 때문이다.
 *
 * 내비게이션이 곧 권한 표시는 아니다. 메뉴에서 감췄다고 API 가 막히는 것은
 * 아니므로, 실제 차단은 언제나 서버의 권한 검사가 한다.
 */

/** role_menu 의 can_* 플래그. 여러 역할이 겹치면 OR 로 합친다 */
export interface MenuPermissions {
  read: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
  approve: boolean;
  /** 엑셀 내려받기. 개인정보 통제 대상이라 따로 둔다 */
  export: boolean;
}

export interface MenuNode {
  menuId: string;
  menuCode: string;
  menuName: string;
  /** 프론트 라우트. 그룹 메뉴는 null 이고 자식으로만 이동한다 */
  menuPath: string | null;
  /** lucide 아이콘 이름 (kebab-case). 매핑은 화면 쪽에 있다 */
  iconName: string | null;
  permissions: MenuPermissions;
  children: MenuNode[];
}

/** 경로로 메뉴를 찾는다. 준비되지 않은 화면을 구분하는 데 쓴다 */
export function findMenuByPath(
  nodes: MenuNode[],
  path: string,
): MenuNode | null {
  for (const node of nodes) {
    if (node.menuPath === path) return node;
    const found = findMenuByPath(node.children, path);
    if (found) return found;
  }
  return null;
}

/**
 * 현재 경로가 어느 최상위 메뉴에 속하는지 찾는다.
 *
 * 정확히 일치하는 것을 먼저 보고, 없으면 접두어로 본다.
 * `/orders/1029` 처럼 상세 화면에 들어가도 레일의 `운송오더` 가 켜져 있어야
 * 사용자가 자기 위치를 잃지 않는다.
 */
export function findActiveTrail(
  nodes: MenuNode[],
  path: string,
): { top: MenuNode; child: MenuNode | null } | null {
  let prefixMatch: { top: MenuNode; child: MenuNode | null } | null = null;

  for (const top of nodes) {
    if (top.menuPath === path) return { top, child: null };

    for (const child of top.children) {
      if (child.menuPath === path) return { top, child };
      if (child.menuPath && path.startsWith(child.menuPath + '/')) {
        prefixMatch ??= { top, child };
      }
    }

    if (top.menuPath && path.startsWith(top.menuPath + '/')) {
      prefixMatch ??= { top, child: null };
    }
  }

  return prefixMatch;
}
