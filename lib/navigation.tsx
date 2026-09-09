'use client';
import { useMemo, useSyncExternalStore, type ComponentProps } from 'react';

const changed = 'northbound:url-change';
function subscribe(listener: () => void) {
  window.addEventListener(changed, listener);
  window.addEventListener('popstate', listener);
  return () => {
    window.removeEventListener(changed, listener);
    window.removeEventListener('popstate', listener);
  };
}

// Static exports contain build-time search params. Read the actual browser URL
// after hydration instead, including Back/Forward and same-page date changes.
export function useSearchParams() {
  const search = useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => '',
  );
  return useMemo(() => new URLSearchParams(search), [search]);
}

export default function Link({
  onClick,
  href,
  children,
  ...props
}: ComponentProps<'a'> & { href: string }) {
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        const anchor = event.currentTarget;
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          anchor.hasAttribute('download') ||
          (anchor.target && anchor.target !== '_self')
        )
          return;
        const url = new URL(anchor.href);
        if (
          url.origin === location.origin &&
          url.pathname === location.pathname &&
          !url.hash
        ) {
          event.preventDefault();
          if (url.href !== location.href) {
            history.pushState(history.state, '', url);
            window.dispatchEvent(new Event(changed));
          }
        }
        // Other pages use the browser's document navigation. Their HTML and
        // assets are precached, so this also works without an RSC server.
      }}
    >
      {children}
    </a>
  );
}

const router = {
  push(href: string) {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin)
      throw new Error('只能跳转到路书内的页面');
    location.assign(url.href);
  },
};
export function useRouter() {
  return router;
}
