import {
  Circle,
  ClipboardList,
  Database,
  Gauge,
  LineChart,
  Receipt,
  Route,
  Settings,
  Truck,
  type LucideIcon,
} from 'lucide-react';

/**
 * `ntms.menu.icon_name` → 아이콘.
 *
 * DB 에 컴포넌트를 저장할 수는 없으므로 이름만 두고 여기서 잇는다.
 * 목록에 없는 이름이 와도 화면이 깨지지 않게 기본 도형으로 떨어뜨린다 —
 * 메뉴 한 줄 때문에 내비게이션 전체가 죽으면 안 된다.
 */
const ICONS: Record<string, LucideIcon> = {
  gauge: Gauge,
  'clipboard-list': ClipboardList,
  route: Route,
  truck: Truck,
  'chart-line': LineChart,
  receipt: Receipt,
  database: Database,
  settings: Settings,
};

export function MenuIcon({
  name,
  size = 20,
  className,
}: {
  name: string | null;
  size?: number;
  className?: string;
}) {
  const Icon = (name && ICONS[name]) || Circle;
  return (
    <Icon size={size} strokeWidth={1.75} aria-hidden="true" className={className} />
  );
}
