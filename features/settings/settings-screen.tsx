'use client';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Download,
  ExternalLink,
  HardDrive,
  MapPin,
  RefreshCw,
  Smartphone,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { useTrip } from '@/features/trip/store';
import type { RoadbookFile } from '@/features/trip/types';
import { downloadText, parseRoadbook } from '@/lib/storage/import-export';
import { listBackups, type Backup } from '@/lib/storage/trip-repository';
import { usePwa } from '@/pwa/register';
import { toast } from '@/components/ui/toast';
export function SettingsScreen() {
  const { snapshot, replace, saving, error: saveError } = useTrip(),
    pwa = usePwa();
  const [installHelp, setInstallHelp] = useState(false),
    [preview, setPreview] = useState<RoadbookFile | null>(null),
    [busy, setBusy] = useState(false),
    [downloading, setDownloading] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(''),
    [backups, setBackups] = useState<Backup[]>([]),
    [configured, setConfigured] = useState<boolean | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void listBackups()
      .then(setBackups)
      .catch(() => {});
    const abort = new AbortController();
    void fetch('/api/amap-config', { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json() as Promise<{ configured: boolean }>;
      })
      .then((c) => setConfigured(c.configured === true))
      .catch(() => {});
    return () => abort.abort();
  }, []);
  const notifyError = (e: unknown) =>
    setError(e instanceof Error ? e.message : '操作未完成，请重试');
  async function readFile(file: File) {
    setError('');
    try {
      if (file.size > 10_000_000)
        throw new Error('文件超过 10 MB，请缩小后重试');
      setPreview(parseRoadbook(await file.text()));
    } catch (e) {
      notifyError(e);
    }
  }
  async function importFile() {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      await replace(preview);
      setPreview(null);
      setBackups(await listBackups());
      toast.add({ title: '路书已导入，原路书已自动备份', type: 'success' });
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AppShell active="settings" title="设置与备份">
      <div className="narrow-page settings-page">
        {(error || pwa.error) && (
          <Alert variant="destructive">
            <AlertDescription>{error || pwa.error}</AlertDescription>
          </Alert>
        )}
        <section className="setting-section">
          <div className="setting-title">
            <Smartphone />
            <div>
              <h2>把路书装进口袋</h2>
              <p>添加到主屏幕，下次像应用一样打开。</p>
            </div>
          </div>
          <div className="setting-row">
            <span>
              {pwa.installed
                ? '已在独立应用窗口打开'
                : pwa.ios
                  ? '安装到 iPhone / iPad'
                  : '安装北行路书'}
            </span>
            <Button
              disabled={pwa.installed}
              onClick={() => {
                if (pwa.canInstall) void pwa.install().catch(notifyError);
                else setInstallHelp(true);
              }}
            >
              {pwa.installed ? (
                <>
                  <Check data-icon="inline-start" />
                  已安装
                </>
              ) : (
                '安装'
              )}
            </Button>
          </div>
          {pwa.updateAvailable && (
            <div className="setting-row">
              <span>有新版本可用</span>
              <Button
                variant="outline"
                disabled={saving || (!!saveError && !!snapshot)}
                onClick={() => void pwa.update().catch(notifyError)}
              >
                <RefreshCw data-icon="inline-start" />
                刷新更新
              </Button>
            </div>
          )}
        </section>
        <section className="setting-section">
          <div className="setting-title">
            <Download />
            <div>
              <h2>出发前，保存离线内容</h2>
              <p>路书、地点和备注随时看；地图、搜索和重新算路需要联网。</p>
            </div>
          </div>
          <div className="setting-row">
            <div>
              <strong>
                {pwa.offline?.complete
                  ? '离线页面已就绪'
                  : '离线页面尚未准备好'}
              </strong>
              <small>
                {pwa.supported
                  ? '路书内容随每次编辑自动保存在本机。'
                  : '正式构建在 HTTPS 或本机地址打开后，可保存离线页面。'}
              </small>
            </div>
            <Button
              variant="outline"
              disabled={!pwa.supported || downloading || saving || !!saveError}
              onClick={async () => {
                setDownloading(true);
                setProgress(0);
                setError('');
                try {
                  await pwa.download((done, total) =>
                    setProgress(Math.round((done / total) * 100)),
                  );
                  toast.add({ title: '离线内容已保存', type: 'success' });
                } catch (e) {
                  notifyError(e);
                } finally {
                  setDownloading(false);
                }
              }}
            >
              <ArrowDownToLine data-icon="inline-start" />
              {downloading ? `${progress}%` : '保存离线'}
            </Button>
          </div>
          {downloading && (
            <Progress value={progress} aria-label="离线下载进度" />
          )}
          <p className="helper-text">
            攻略链接的原文仍需联网查看。浏览器清理存储后，离线内容也会被清理；出发前请再导出一份备份。
          </p>
        </section>
        <section className="setting-section">
          <div className="setting-title">
            <HardDrive />
            <div>
              <h2>路书与备份</h2>
              <p>数据保存在这台设备。换设备时，导出再导入。</p>
            </div>
          </div>
          <div className="setting-row">
            <div>
              <strong>导出路书</strong>
              <small>包含地点、备注、攻略链接和已保存的路线</small>
            </div>
            <Button
              variant="outline"
              disabled={!snapshot}
              onClick={() => {
                if (snapshot)
                  downloadText(
                    JSON.stringify(
                      { ...snapshot.trip, routeRecords: snapshot.records },
                      null,
                      2,
                    ),
                    `北行路书-${new Date().toLocaleDateString('sv-SE')}.json`,
                  );
              }}
            >
              <ArrowDownToLine data-icon="inline-start" />
              导出
            </Button>
          </div>
          <div className="setting-row">
            <div>
              <strong>导入路书</strong>
              <small>先预览；替换前自动备份当前路书</small>
            </div>
            <Button
              variant="outline"
              disabled={saving || (!!saveError && !!snapshot)}
              onClick={() => fileInput.current?.click()}
            >
              <ArrowUpFromLine data-icon="inline-start" />
              导入
            </Button>
            <input
              ref={fileInput}
              className="sr-only"
              aria-label="选择路书 JSON 文件"
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void readFile(file);
              }}
            />
          </div>
          {backups.length > 0 && (
            <div className="backup-list">
              <h3>自动备份</h3>
              {backups.map((b) => (
                <div className="backup-row" key={b.id}>
                  <div>
                    <strong>{b.label}</strong>
                    <small>
                      {new Date(b.createdAt).toLocaleString('zh-CN')}
                    </small>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      downloadText(
                        b.raw,
                        `北行路书-备份-${b.createdAt.slice(0, 10)}.json`,
                      )
                    }
                  >
                    导出
                  </Button>
                  <Button
                    variant="outline"
                    disabled={saving || (!!saveError && !!snapshot)}
                    onClick={() => {
                      try {
                        setPreview(parseRoadbook(b.raw));
                      } catch (e) {
                        notifyError(e);
                      }
                    }}
                  >
                    恢复
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
        {snapshot?.trip.links.length ? (
          <section className="setting-section">
            <h2>行程参考</h2>
            <div className="guide-links">
              {snapshot.trip.links.map((link) => (
                <a
                  key={link.id}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <div>
                    <strong>{link.title}</strong>
                    <small>{link.note}</small>
                  </div>
                  <ExternalLink />
                </a>
              ))}
            </div>
          </section>
        ) : null}
        <section className="setting-section">
          <div className="setting-title">
            <MapPin />
            <div>
              <h2>地图连接</h2>
              <p>
                {configured === true
                  ? '高德配置已填写，实际查询以返回结果为准。'
                  : configured === false
                    ? '高德尚未配置；地点和备注可先编辑保存。'
                    : '暂时无法确认地图连接状态。'}
              </p>
            </div>
          </div>
        </section>
        <p className="settings-version">
          北行路书 · 0.2.1
          {pwa.offline?.version ? ` · ${pwa.offline.version.slice(0, 8)}` : ''}
        </p>
      </div>
      <Dialog open={installHelp} onOpenChange={setInstallHelp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>安装北行路书</DialogTitle>
            <DialogDescription>
              {pwa.ios
                ? '在 Safari 中打开路书，点分享，选择「添加到主屏幕」，如有「作为 Web App 打开」选项请开启。'
                : '在浏览器菜单中选择「安装应用」或「添加到主屏幕」。若没有入口，请用支持安装的浏览器打开正式 HTTPS 地址。'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setInstallHelp(false)}>知道了</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open && !busy) setPreview(null);
        }}
      >
        <DialogContent className="import-dialog" showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>导入这份路书？</DialogTitle>
            <DialogDescription>
              当前路书会自动备份，再用下面这份替换。
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <>
              <h3>{preview.title}</h3>
              <p>
                {preview.startDate} — {preview.endDate}
                <br />
                {preview.days.length} 天 ·{' '}
                {preview.days.reduce((n, d) => n + d.stops.length, 0)} 个地点
              </p>
              <ul className="import-days">
                {preview.days.map((d) => (
                  <li key={d.id}>
                    <strong>{d.date}</strong>
                    <span>
                      {d.stops.map((s) => s.name).join(' → ') || '暂无地点'}
                    </span>
                  </li>
                ))}
              </ul>
              {preview.unscheduled.length > 0 && (
                <p className="helper-text">
                  另保留 {preview.unscheduled.length}{' '}
                  条未安排资料，不会自动加入当天路线。
                </p>
              )}
            </>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              取消
            </Button>
            <Button
              disabled={busy || saving || (!!saveError && !!snapshot)}
              onClick={() => void importFile()}
            >
              {busy ? '正在导入…' : '备份并导入'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
