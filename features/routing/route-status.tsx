'use client';
import type { Day } from '@/features/trip/types';
import { legsForDay, position } from '@/features/trip/selectors';
import { useTrip } from '@/features/trip/store';
import { useRouting } from './use-route-planning';
export function RouteStatus({ day }: { day: Day }) {
  const { online, snapshot } = useTrip(),
    { states } = useRouting();
  const legs = legsForDay(day, snapshot?.records),
    loading = legs.some((l) => l.key && states[l.key]?.status === 'loading');
  const error = legs
    .map((l) => (l.key ? states[l.key]?.message : undefined))
    .find(Boolean);
  const missing = day.stops.filter((s) => !position(s)).length;
  let message = '';
  if (!online) message = '当前离线，地点与备注可以继续编辑。联网后更新路线。';
  else if (loading) message = '正在按新的地点顺序规划路线…';
  else if (error) message = error;
  else if (missing && day.stops.length > 1)
    message = `${missing} 个地点还没有具体位置，在编辑中选好后自动算路。`;
  return message ? <output className="route-status">{message}</output> : null;
}
