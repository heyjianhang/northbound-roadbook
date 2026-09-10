'use client';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { mobilePlatform } from '@/lib/mobile-platform';
type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
type OfflineStatus = { complete: boolean; version: string; count: number };
type PwaContextValue = {
  installed: boolean;
  canInstall: boolean;
  ios: boolean;
  supported: boolean;
  updateAvailable: boolean;
  offline: OfflineStatus | null;
  error: string;
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
  download: (progress: (done: number, total: number) => void) => Promise<void>;
  update: () => Promise<void>;
};
const PwaContext = createContext<PwaContextValue | null>(null);
function message<T>(
  worker: ServiceWorker,
  data: object,
  progress?: (done: number, total: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel(),
      timer = setTimeout(() => {
        channel.port1.close();
        reject(new Error('离线保存超时，请检查网络后重试'));
      }, 60000);
    channel.port1.onmessage = (e) => {
      if (e.data.type === 'PROGRESS') {
        progress?.(e.data.done, e.data.total);
        return;
      }
      clearTimeout(timer);
      channel.port1.close();
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data);
    };
    worker.postMessage(data, [channel.port2]);
  });
}
export function PwaProvider({ children }: { children: React.ReactNode }) {
  const [installed, setInstalled] = useState(false),
    [canInstall, setCanInstall] = useState(false),
    [ios, setIos] = useState(false),
    [supported, setSupported] = useState(false),
    [updateAvailable, setUpdateAvailable] = useState(false),
    [offline, setOffline] = useState<OfflineStatus | null>(null),
    [error, setError] = useState('');
  const prompt = useRef<InstallPrompt | null>(null),
    registration = useRef<ServiceWorkerRegistration | null>(null);
  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) setIos(mobilePlatform(navigator) === 'ios');
    });
    const standalone = matchMedia('(display-mode: standalone)');
    const checkInstalled = () =>
      setInstalled(
        standalone.matches ||
          !!(navigator as Navigator & { standalone?: boolean }).standalone,
      );
    let lastUpdateCheck = 0;
    const resume = () => {
      if (disposed || document.visibilityState === 'hidden') return;
      checkInstalled();
      const reg = registration.current;
      if (reg && Date.now() - lastUpdateCheck > 60000) {
        lastUpdateCheck = Date.now();
        void reg.update().catch(() => {});
      }
    };
    queueMicrotask(checkInstalled);
    standalone.addEventListener('change', checkInstalled);
    const beforeInstall = (e: Event) => {
      e.preventDefault();
      prompt.current = e as InstallPrompt;
      setCanInstall(true);
    };
    const didInstall = () => {
      setInstalled(true);
      setCanInstall(false);
      prompt.current = null;
    };
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', didInstall);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', resume);
    if (
      'serviceWorker' in navigator &&
      window.isSecureContext &&
      process.env.NODE_ENV === 'production'
    ) {
      void navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })
        .then(async (reg) => {
          if (disposed) return;
          registration.current = reg;
          setSupported(true);
          setUpdateAvailable(!!reg.waiting);
          reg.addEventListener('updatefound', () => {
            reg.installing?.addEventListener('statechange', () => {
              if (!disposed)
                setUpdateAvailable(
                  !!reg.waiting && !!navigator.serviceWorker.controller,
                );
            });
          });
          const active =
            reg.active || (await navigator.serviceWorker.ready).active;
          if (active && !disposed)
            setOffline(
              await message<OfflineStatus>(active, { type: 'STATUS' }),
            );
        })
        .catch((e) => {
          if (!disposed)
            setError(e instanceof Error ? e.message : '离线功能暂不可用');
        });
    }
    return () => {
      disposed = true;
      standalone.removeEventListener('change', checkInstalled);
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      window.removeEventListener('appinstalled', didInstall);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, []);
  async function install() {
    if (!prompt.current) return 'unavailable' as const;
    const p = prompt.current;
    prompt.current = null;
    setCanInstall(false);
    await p.prompt();
    const choice = await p.userChoice;
    return choice.outcome === 'accepted'
      ? ('accepted' as const)
      : ('dismissed' as const);
  }
  async function download(progress: (done: number, total: number) => void) {
    setError('');
    const reg = registration.current;
    if (!reg?.active) throw new Error('离线功能还没有就绪，请稍后重试');
    if (navigator.onLine) await reg.update();
    if (reg.waiting) {
      setUpdateAvailable(true);
      throw new Error('有新版本，请先更新，再保存离线内容');
    }
    const result = await message<OfflineStatus>(
      reg.active,
      { type: 'SAVE_OFFLINE' },
      progress,
    );
    setOffline(result);
    if (!result.complete) throw new Error('部分页面未能保存，请重试');
    if (navigator.storage?.persist)
      await navigator.storage.persist().catch(() => false);
  }
  async function update() {
    const waiting = registration.current?.waiting;
    if (!waiting) return;
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => window.location.reload(),
      { once: true },
    );
    waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
  }
  return (
    <PwaContext.Provider
      value={{
        installed,
        canInstall,
        ios,
        supported,
        updateAvailable,
        offline,
        error,
        install,
        download,
        update,
      }}
    >
      {children}
    </PwaContext.Provider>
  );
}
export function usePwa() {
  const value = useContext(PwaContext);
  if (!value) throw new Error('PwaProvider is required');
  return value;
}
