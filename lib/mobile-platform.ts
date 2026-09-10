export function mobilePlatform(navigator: {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
}): 'ios' | 'android' | 'desktop' {
  if (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1)
  )
    return 'ios';
  return /android/i.test(navigator.userAgent) ? 'android' : 'desktop';
}
