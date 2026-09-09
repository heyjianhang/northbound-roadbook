'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from '@/lib/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
export function LeaveGuard({ dirty }: { dirty: boolean }) {
  const [target, setTarget] = useState<string | null>(null),
    router = useRouter(),
    bypass = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    const ownUrl = window.location.href,
      ownState = history.state;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (!bypass.current) {
        e.preventDefault();
      }
    };
    const click = (e: MouseEvent) => {
      if (
        bypass.current ||
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      const link = (e.target as Element).closest<HTMLAnchorElement>('a[href]');
      if (
        !link ||
        link.target === '_blank' ||
        link.hasAttribute('download') ||
        link.href === ownUrl ||
        link.getAttribute('href')?.startsWith('#')
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      setTarget(link.href);
    };
    const pop = (e: PopStateEvent) => {
      if (bypass.current || location.href === ownUrl) return;
      const destination = location.href;
      e.stopImmediatePropagation();
      history.pushState(ownState, '', ownUrl);
      setTarget(destination);
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', click, true);
    window.addEventListener('popstate', pop, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', click, true);
      window.removeEventListener('popstate', pop, true);
    };
  }, [dirty]);
  return (
    <Dialog
      open={!!target}
      onOpenChange={(open) => {
        if (!open) setTarget(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>离开编辑？</DialogTitle>
          <DialogDescription>这次修改还没有保存。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setTarget(null)}>
            继续编辑
          </Button>
          <Button
            onClick={() => {
              if (!target) return;
              bypass.current = true;
              const url = new URL(target);
              if (url.origin === location.origin)
                router.push(url.pathname + url.search + url.hash);
              else location.href = target;
            }}
          >
            放弃修改并离开
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
