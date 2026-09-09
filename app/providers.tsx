'use client';
import { useEffect, useRef } from 'react';
import { PwaProvider, usePwa } from '@/pwa/register';

function AutomaticUpdates() {
  const { updateAvailable, update } = usePwa();
  const started = useRef(false);
  useEffect(() => {
    if (updateAvailable && !started.current) {
      started.current = true;
      void update();
    }
  }, [updateAvailable, update]);
  return null;
}
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PwaProvider>
      <AutomaticUpdates />
      {children}
    </PwaProvider>
  );
}
