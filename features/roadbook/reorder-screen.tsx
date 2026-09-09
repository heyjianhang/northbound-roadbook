'use client';
import { flushSync } from 'react-dom';
import Link from '@/lib/navigation';
import { useRef, useState } from 'react';
import { useRouter } from '@/lib/navigation';
import { ArrowDown, ArrowUp, Check, GripVertical } from 'lucide-react';
import { AppShell, href, useCurrentDay } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { useTrip } from '@/features/trip/store';
import type { Day } from '@/features/trip/types';
import { reorderStops } from '@/features/trip/commands';
import { toast } from '@/components/ui/toast';
import { LeaveGuard } from '@/features/places/leave-guard';
function OrderEditor({ day }: { day: Day }) {
  const [initial] = useState(() => day.stops.map((s) => s.id)),
    [ids, setIds] = useState(initial),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [dragging, setDragging] = useState<string | null>(null);
  const activeDrag = useRef<string | null>(null),
    { commit } = useTrip(),
    router = useRouter();
  const dirty = !saved && ids.join(',') !== initial.join(',');
  const move = (id: string, index: number) =>
    setIds((current) => {
      const next = current.filter((s) => s !== id);
      next.splice(Math.max(0, Math.min(index, next.length)), 0, id);
      return next;
    });
  return (
    <div className="narrow-page">
      <p className="page-intro">
        拖动左侧手柄，或用上下箭头调整。保存后自动重新规划路线。
      </p>
      <ol className="reorder-list">
        {ids.map((id, i) => {
          const stop = day.stops.find((s) => s.id === id);
          if (!stop) return null;
          return (
            <li
              key={id}
              data-stop-id={id}
              className={dragging === id ? 'dragging' : ''}
            >
              <button
                className="drag-handle"
                type="button"
                aria-label={`拖动 ${stop.name}`}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  activeDrag.current = id;
                  setDragging(id);
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (!activeDrag.current) return;
                  const row = document
                    .elementFromPoint(e.clientX, e.clientY)
                    ?.closest<HTMLElement>('[data-stop-id]');
                  if (row?.dataset.stopId && row.dataset.stopId !== id) {
                    const target = ids.indexOf(row.dataset.stopId);
                    if (target >= 0) move(id, target);
                  }
                }}
                onPointerUp={() => {
                  activeDrag.current = null;
                  setDragging(null);
                }}
                onPointerCancel={() => {
                  activeDrag.current = null;
                  setDragging(null);
                }}
              >
                <GripVertical />
              </button>
              <span className="order-number">{i + 1}</span>
              <div>
                <strong>{stop.name}</strong>
                <small>{stop.area}</small>
              </div>
              <div className="order-buttons">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`上移 ${stop.name}`}
                  disabled={i === 0}
                  onClick={() => move(id, i - 1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`下移 ${stop.name}`}
                  disabled={i === ids.length - 1}
                  onClick={() => move(id, i + 1)}
                >
                  <ArrowDown />
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
      {ids.length < 2 && (
        <p className="helper-text">至少添加两个地点后才需要调整顺序。</p>
      )}
      <div className="form-footer">
        <Link className="outline-link" href={href('/', day)}>
          取消
        </Link>
        <Button
          disabled={!dirty || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await commit((t) => reorderStops(t, day.id, ids));
              flushSync(() => setSaved(true));
              toast.add({ title: '顺序已保存', type: 'success' });
              router.push(href('/', day));
            } catch (e) {
              toast.add({
                title: e instanceof Error ? e.message : '排序失败',
                type: 'error',
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          <Check data-icon="inline-start" />
          {busy ? '保存中…' : '保存顺序'}
        </Button>
      </div>
      <LeaveGuard dirty={dirty} />
    </div>
  );
}
export function ReorderScreen() {
  const day = useCurrentDay();
  return (
    <AppShell title="调整地点顺序">
      {day && <OrderEditor key={day.id} day={day} />}
    </AppShell>
  );
}
