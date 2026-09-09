import type { Stop } from '../features/trip/types.ts';
import { position } from '../features/trip/selectors.ts';
export function navigationUrl(stop: Stop): string | null {
  const p = position(stop); if (!p) return null;
  const query = new URLSearchParams({ to: `${p[0]},${p[1]},${stop.name}`, mode: 'car', policy: '0', coordinate: 'gaode', callnative: '1', src: 'northbound-roadbook' });
  return `https://uri.amap.com/navigation?${query}`;
}
