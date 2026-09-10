'use client';
import { useSyncExternalStore } from 'react';
import { mobilePlatform } from './mobile-platform';

const subscribe = () => () => {};
const getPlatform = () => mobilePlatform(navigator);
const getServerPlatform = () => 'desktop' as const;

// Keep prerendered HTML consistent, then select the installed App's scheme.
export function useMobilePlatform() {
  return useSyncExternalStore(subscribe, getPlatform, getServerPlatform);
}
