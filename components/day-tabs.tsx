'use client';
import Link from '@/lib/navigation';
import { useTrip } from '@/features/trip/store';
import { href } from './app-shell';
import type { Day } from '@/features/trip/types';
export function DayTabs({ day, path = '/' }: { day: Day; path?: string }) {
  const { snapshot } = useTrip();
  return (
    <nav className="day-tabs" aria-label="选择日期">
      {snapshot!.trip.days.map((d, i) => (
        <Link
          key={d.id}
          href={href(path, d)}
          aria-current={day.id === d.id ? 'date' : undefined}
        >
          <span>DAY {String(i + 1).padStart(2, '0')}</span>
          <strong>
            {Number(d.date.slice(5, 7))}月{Number(d.date.slice(8))}日
          </strong>
        </Link>
      ))}
    </nav>
  );
}
