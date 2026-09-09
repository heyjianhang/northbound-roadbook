import content from '../../data/roadbook.json';
import type { RoadbookFile, Stop } from '../trip/types';
import { navigationUrl } from '../../lib/amap-navigation';

// The fixed JSON is checked by the static-roadbook integration test.
export const roadbook = content as unknown as RoadbookFile;
export type View = 'roadbook' | 'route' | 'place';
export function pageUrl(view: View, dayId: string, stopId?: string) {
  const query = new URLSearchParams({ day: dayId });
  if (view !== 'roadbook') query.set('view', view);
  if (stopId) query.set('stop', stopId);
  return `/?${query}`;
}
export function selectedPage(
  params: URLSearchParams,
  fallback: View = 'roadbook',
) {
  const selected = params.get('day');
  const day =
    roadbook.days.find((d) => d.id === selected || d.date === selected) ||
    roadbook.days[0];
  const queryView = params.get('view');
  const view: View =
    queryView && ['roadbook', 'route', 'place'].includes(queryView)
      ? (queryView as View)
      : fallback;
  return {
    day,
    view,
    stop: day.stops.find((s) => s.id === params.get('stop')),
  };
}
export function amapLink(stop: Stop) {
  const navigation = navigationUrl(stop);
  if (navigation) return { href: navigation, label: '高德导航' };
  const query = new URLSearchParams({
    keyword: stop.name,
    city: '呼伦贝尔',
    view: 'list',
    callnative: '1',
    src: 'northbound-roadbook',
  });
  return { href: `https://uri.amap.com/search?${query}`, label: '高德找地点' };
}

export function mapPlaceUrl(dayId: string, stopId: string, mapDayId: string) {
  return `${pageUrl('place', dayId, stopId)}&from=route&mapDay=${encodeURIComponent(mapDayId)}`;
}
export function placeBackUrl(params: URLSearchParams, dayId: string) {
  const originDay =
    roadbook.days.find((d) => d.id === params.get('mapDay'))?.id || dayId;
  return pageUrl(
    params.get('from') === 'route' ? 'route' : 'roadbook',
    params.get('from') === 'route' ? originDay : dayId,
  );
}
