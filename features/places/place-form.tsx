'use client';
import { flushSync } from 'react-dom';
import { useState } from 'react';
import { useRouter } from '@/lib/navigation';
import { Check, MapPin, Plus, Trash2 } from 'lucide-react';
import { useTrip } from '@/features/trip/store';
import { putStop, uid } from '@/features/trip/commands';
import type { Day, Stop } from '@/features/trip/types';
import { href } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { safeUrl } from '@/lib/storage/import-export';
import { toast } from '@/components/ui/toast';
import { LeaveGuard } from './leave-guard';
import { LocationPicker } from './location-picker';

export function PlaceForm({
  initial,
  day: originalDay,
  isNew = false,
  onCancel,
}: {
  initial: Stop;
  day: Day;
  isNew?: boolean;
  onCancel?: () => void;
}) {
  const { snapshot, commit } = useTrip(),
    router = useRouter();
  const [stop, setStop] = useState(initial),
    [dayId, setDayId] = useState(originalDay.id);
  const [order, setOrder] = useState(
    isNew
      ? originalDay.stops.length
      : originalDay.stops.findIndex((s) => s.id === initial.id),
  );
  const [lng, setLng] = useState(initial.lng?.toString() || ''),
    [lat, setLat] = useState(initial.lat?.toString() || '');
  const [minutes, setMinutes] = useState(String(initial.durationMin)),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [picker, setPicker] = useState(false);
  const day = snapshot!.trip.days.find((d) => d.id === dayId)!,
    remaining = day.stops.filter((s) => s.id !== stop.id);
  const dirty =
    !saved &&
    (isNew ||
      JSON.stringify(stop) !== JSON.stringify(initial) ||
      dayId !== originalDay.id ||
      order !== originalDay.stops.findIndex((s) => s.id === initial.id) ||
      lng !== (initial.lng?.toString() || '') ||
      lat !== (initial.lat?.toString() || '') ||
      minutes !== String(initial.durationMin));
  async function submit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const a = lng.trim() ? Number(lng) : null,
      b = lat.trim() ? Number(lat) : null;
    if (!stop.name.trim()) {
      setError('请填写地点名称');
      return;
    }
    if (
      (a === null) !== (b === null) ||
      (a !== null && (!Number.isFinite(a) || Math.abs(a) > 180)) ||
      (b !== null && (!Number.isFinite(b) || Math.abs(b) > 90))
    ) {
      setError('请同时填写有效的经纬度，或同时留空');
      return;
    }
    if (
      !minutes.trim() ||
      !Number.isFinite(Number(minutes)) ||
      Number(minutes) < 0 ||
      Number(minutes) > 1440
    ) {
      setError('停留时间应在 0 到 1440 分钟之间');
      return;
    }
    if (stop.links.some((l) => !safeUrl(l.url) || !l.title.trim())) {
      setError('攻略需要标题和完整的 http/https 网址');
      return;
    }
    setBusy(true);
    try {
      await commit((trip) =>
        putStop(
          trip,
          dayId,
          {
            ...stop,
            name: stop.name.trim(),
            lng: a,
            lat: b,
            durationMin: Number(minutes),
          },
          order,
        ),
      );
      flushSync(() => setSaved(true));
      toast.add({
        title: isNew ? '地点已添加' : '地点已保存',
        type: 'success',
      });
      router.push(href('/', dayId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <form className="place-form" onSubmit={submit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="stop-name">地点名称</FieldLabel>
            <Input
              id="stop-name"
              value={stop.name}
              maxLength={300}
              required
              onChange={(e) => setStop({ ...stop, name: e.target.value })}
              placeholder="想去哪里？"
            />
          </Field>
          <div className="form-grid">
            <Field>
              <FieldLabel htmlFor="stop-day">安排日期</FieldLabel>
              <NativeSelect
                id="stop-day"
                value={dayId}
                onChange={(e) => {
                  setDayId(e.target.value);
                  setOrder(
                    snapshot!.trip.days
                      .find((d) => d.id === e.target.value)!
                      .stops.filter((s) => s.id !== stop.id).length,
                  );
                }}
              >
                {snapshot!.trip.days.map((d, i) => (
                  <NativeSelectOption key={d.id} value={d.id}>
                    第 {i + 1} 天 · {d.date.slice(5).replace('-', '月')}日
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="stop-position">当天顺序</FieldLabel>
              <NativeSelect
                id="stop-position"
                value={order}
                onChange={(e) => setOrder(Number(e.target.value))}
              >
                {remaining.map((s, i) => (
                  <NativeSelectOption key={s.id} value={i}>
                    放在「{s.name}」之前
                  </NativeSelectOption>
                ))}
                <NativeSelectOption value={remaining.length}>
                  放在最后
                </NativeSelectOption>
              </NativeSelect>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="stop-area">所在区域</FieldLabel>
            <Input
              id="stop-area"
              maxLength={300}
              value={stop.area}
              onChange={(e) => setStop({ ...stop, area: e.target.value })}
              placeholder="例如：根河、室韦"
            />
          </Field>
          <Field>
            <div className="section-heading">
              <FieldLabel>地点位置</FieldLabel>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPicker(true)}
              >
                <MapPin data-icon="inline-start" />
                搜索或地图选点
              </Button>
            </div>
            <div className="form-grid">
              <Field>
                <FieldLabel htmlFor="stop-lng">经度</FieldLabel>
                <Input
                  id="stop-lng"
                  inputMode="decimal"
                  value={lng}
                  onChange={(e) => {
                    setLng(e.target.value);
                    setStop((s) => ({ ...s, amapId: '' }));
                  }}
                  placeholder="可暂时留空"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="stop-lat">纬度</FieldLabel>
                <Input
                  id="stop-lat"
                  inputMode="decimal"
                  value={lat}
                  onChange={(e) => {
                    setLat(e.target.value);
                    setStop((s) => ({ ...s, amapId: '' }));
                  }}
                  placeholder="可暂时留空"
                />
              </Field>
            </div>
            <FieldDescription>
              使用高德坐标。位置留空也能保存，选好位置后自动规划路线。
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="stop-duration">计划停留 · 分钟</FieldLabel>
            <Input
              id="stop-duration"
              type="number"
              min="0"
              max="1440"
              step="1"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="stop-note">随手记</FieldLabel>
            <Textarea
              id="stop-note"
              maxLength={10000}
              value={stop.note}
              rows={4}
              onChange={(e) => setStop({ ...stop, note: e.target.value })}
              placeholder="想看的风景、入口、停车位置……"
            />
          </Field>
          <Field>
            <div className="section-heading">
              <FieldLabel>攻略链接</FieldLabel>
              <Button
                type="button"
                variant="ghost"
                disabled={stop.links.length >= 200}
                onClick={() =>
                  setStop((s) => ({
                    ...s,
                    links: [
                      ...s.links,
                      { id: uid('link'), title: '', url: '', note: '' },
                    ],
                  }))
                }
              >
                <Plus data-icon="inline-start" />
                添加
              </Button>
            </div>
            {stop.links.map((link, i) => (
              <div className="link-form" key={link.id}>
                <Input
                  aria-label={`攻略 ${i + 1} 标题`}
                  maxLength={300}
                  placeholder="标题"
                  value={link.title}
                  onChange={(e) =>
                    setStop((s) => ({
                      ...s,
                      links: s.links.map((l) =>
                        l.id === link.id ? { ...l, title: e.target.value } : l,
                      ),
                    }))
                  }
                />
                <Input
                  aria-label={`攻略 ${i + 1} 网址`}
                  type="url"
                  maxLength={4000}
                  placeholder="https://…"
                  value={link.url}
                  onChange={(e) =>
                    setStop((s) => ({
                      ...s,
                      links: s.links.map((l) =>
                        l.id === link.id ? { ...l, url: e.target.value } : l,
                      ),
                    }))
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`删除攻略 ${i + 1}`}
                  onClick={() =>
                    setStop((s) => ({
                      ...s,
                      links: s.links.filter((l) => l.id !== link.id),
                    }))
                  }
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </Field>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="form-footer">
            {onCancel && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (!dirty || window.confirm('放弃这次未保存的修改？'))
                    onCancel();
                }}
              >
                取消
              </Button>
            )}
            <Button type="submit" disabled={busy}>
              <Check data-icon="inline-start" />
              {busy ? '保存中…' : isNew ? '添加到路书' : '保存修改'}
            </Button>
          </div>
        </FieldGroup>
      </form>
      <LeaveGuard dirty={dirty} />
      <Dialog open={picker} onOpenChange={setPicker}>
        <DialogContent className="location-dialog">
          <DialogHeader>
            <DialogTitle>选择地点位置</DialogTitle>
            <DialogDescription>
              搜索地点或在地图上点选。选择后仍可修改名称和备注。
            </DialogDescription>
          </DialogHeader>
          <LocationPicker
            day={day}
            onChoose={(p) => {
              setLng(String(p.lng));
              setLat(String(p.lat));
              setStop((s) => ({
                ...s,
                name: s.name || p.name,
                area: p.area || s.area,
                amapId: p.amapId,
              }));
              setPicker(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
