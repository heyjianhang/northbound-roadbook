'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { TextField, NoteField, Choice, numberValue, Notice } from './controls';
import {
  kindNames,
  priorityNames,
  dateNow,
  type Place,
  type Visit,
} from '@/lib/planner';
export function PlaceEditor({
  place,
  visit,
  onClose,
  onSave,
}: {
  place: Place;
  visit?: Visit;
  onClose: () => void;
  onSave: (p: Place, v?: Visit) => boolean;
}) {
  const [p, setP] = useState(place),
    [v, setV] = useState(visit);
  const [error, setError] = useState('');
  const camping = p.camping ?? {
    permission: 'pending',
    toilet: 'unknown',
    note: '',
    backup: '',
  };
  function updateCamping(changes: Partial<NonNullable<Place['camping']>>) {
    setP({ ...p, camping: { ...camping, ...changes } });
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="editor-dialog">
        <DialogHeader>
          <DialogTitle>{visit ? '编辑停靠点' : '添加停靠点'}</DialogTitle>
          <DialogDescription>
            同一地点的名称、位置和备注会同步到其他日期。坐标使用高德 GCJ-02。
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if ((p.lng === null) !== (p.lat === null)) {
              setError('经度和纬度需同时填写，或同时留空。');
              return;
            }
            if (onSave({ ...p, checkedAt: dateNow() }, v)) onClose();
          }}
        >
          <FieldGroup>
            <TextField
              label="地点名称"
              value={p.name}
              required
              maxLength={120}
              onChange={(e) => setP({ ...p, name: e.target.value })}
            />
            <div className="form-grid">
              <Choice
                label="地点类型"
                value={p.kind}
                options={Object.entries(kindNames).map(([value, label]) => ({
                  value,
                  label,
                }))}
                onChange={(value) =>
                  setP({ ...p, kind: value as Place['kind'] })
                }
              />
              {v && v.priority !== 'anchor' && (
                <Choice
                  label="优先级"
                  value={v.priority}
                  options={Object.entries(priorityNames)
                    .filter(([k]) => k !== 'anchor')
                    .map(([value, label]) => ({ value, label }))}
                  onChange={(value) =>
                    setV({
                      ...v,
                      priority: value as Visit['priority'],
                      enabled: value === 'required' ? true : v.enabled,
                    })
                  }
                />
              )}
              <TextField
                label="区域"
                value={p.area}
                onChange={(e) => setP({ ...p, area: e.target.value })}
              />
              {v && (
                <TextField
                  label="停留（分钟）"
                  type="number"
                  min={0}
                  max={1440}
                  value={v.durationMin}
                  onChange={(e) =>
                    setV({ ...v, durationMin: Number(e.target.value) })
                  }
                />
              )}
              <TextField
                label="经度"
                type="number"
                step="any"
                min={-180}
                max={180}
                value={p.lng ?? ''}
                onChange={(e) =>
                  setP({ ...p, lng: numberValue(e.target.value) })
                }
              />
              <TextField
                label="纬度"
                type="number"
                step="any"
                min={-90}
                max={90}
                value={p.lat ?? ''}
                onChange={(e) =>
                  setP({ ...p, lat: numberValue(e.target.value) })
                }
              />
            </div>
            <TextField
              label="高德地点 ID（可选）"
              value={p.amapId}
              onChange={(e) => setP({ ...p, amapId: e.target.value })}
            />
            <TextField
              label="来源 / 攻略链接"
              type="url"
              value={p.sourceUrl}
              onChange={(e) => setP({ ...p, sourceUrl: e.target.value })}
            />
            <NoteField
              label="备注：入口、门票、营地条件等"
              value={p.note}
              onChange={(e) => setP({ ...p, note: e.target.value })}
            />
            <Choice
              label="营业 / 进入条件核实"
              value={p.verification}
              options={[
                { value: 'pending', label: '待核实' },
                { value: 'confirmed', label: '已人工确认（在备注记录依据）' },
              ]}
              onChange={(value) =>
                setP({ ...p, verification: value as Place['verification'] })
              }
            />
            {p.kind === 'camp' && (
              <>
                <div className="form-grid">
                  <Choice
                    label="本次过夜方式是否获准"
                    value={camping.permission}
                    options={[
                      { value: 'pending', label: '待联系 / 现场确认' },
                      {
                        value: 'allowed',
                        label: '已确认（备注写明住店或扎营）',
                      },
                      { value: 'forbidden', label: '不允许，需更换方案' },
                    ]}
                    onChange={(value) =>
                      updateCamping({
                        permission: value as NonNullable<
                          Place['camping']
                        >['permission'],
                      })
                    }
                  />
                  <Choice
                    label="厕所与卫生"
                    value={camping.toilet}
                    options={[
                      { value: 'unknown', label: '尚未核实' },
                      { value: 'clean', label: '已确认有干净厕所' },
                      { value: 'poor', label: '卫生不满意' },
                      { value: 'none', label: '没有厕所' },
                    ]}
                    onChange={(value) =>
                      updateCamping({
                        toilet: value as NonNullable<
                          Place['camping']
                        >['toilet'],
                      })
                    }
                  />
                </div>
                <NoteField
                  label="过夜条件与确认依据"
                  placeholder="是否允许自带帐篷过夜、风景与避风条件、停车位置；记录联系人、确认日期和现场情况。"
                  value={camping.note}
                  onChange={(e) => updateCamping({ note: e.target.value })}
                />
                <TextField
                  label="备选酒店 / 过夜方案"
                  placeholder="地点、联系方式或待查询区域"
                  value={camping.backup}
                  onChange={(e) => updateCamping({ backup: e.target.value })}
                />
                <p className="helper">
                  观景、停车和允许搭帐篷过夜是不同条件。未确认许可的地点先保留为候选。
                </p>
              </>
            )}
            {error && <Notice error>{error}</Notice>}
            <div className="actions">
              <Button variant="outline" onClick={onClose}>
                取消
              </Button>
              <Button type="submit">保存停靠点</Button>
            </div>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
