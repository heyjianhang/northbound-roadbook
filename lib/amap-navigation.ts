import type { Stop } from '../features/trip/types.ts';
import { position } from '../features/trip/selectors.ts';
import type { mobilePlatform } from './mobile-platform';
type Platform = ReturnType<typeof mobilePlatform>;

export function navigationUrl(
  stop: Stop,
  platform: Platform = 'desktop',
): string | null {
  const p = position(stop);
  if (!p) return null;
  if (platform !== 'desktop') {
    const query = new URLSearchParams({
      sourceApplication: 'northbound-roadbook',
      poiname: stop.name,
      lat: String(p[1]),
      lon: String(p[0]),
      dev: '0',
      style: '0',
    });
    return `${platform === 'ios' ? 'iosamap' : 'androidamap'}://navi?${query}`;
  }
  const query = new URLSearchParams({
    to: `${p[0]},${p[1]},${stop.name}`,
    mode: 'car',
    policy: '0',
    coordinate: 'gaode',
    callnative: '1',
    src: 'northbound-roadbook',
  });
  return `https://uri.amap.com/navigation?${query}`;
}

export function amapSearchUrl(name: string, platform: Platform = 'desktop') {
  if (platform !== 'desktop') {
    const query = new URLSearchParams({
      sourceApplication: 'northbound-roadbook',
      [platform === 'ios' ? 'name' : 'keywords']: `呼伦贝尔 ${name}`,
      dev: '0',
    });
    return `${platform === 'ios' ? 'iosamap' : 'androidamap'}://poi?${query}`;
  }
  const query = new URLSearchParams({
    keyword: name,
    city: '呼伦贝尔',
    view: 'list',
    callnative: '1',
    src: 'northbound-roadbook',
  });
  return `https://uri.amap.com/search?${query}`;
}
