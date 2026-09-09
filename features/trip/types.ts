export type XY = [number, number];
export type GuideLink = {
  id: string;
  title: string;
  url: string;
  note: string;
};
export type Stop = {
  id: string;
  name: string;
  lng: number | null;
  lat: number | null;
  amapId: string;
  area: string;
  durationMin: number;
  note: string;
  links: GuideLink[];
};
export type Day = {
  id: string;
  date: string;
  title: string;
  subtitle: string;
  note: string;
  stops: Stop[];
};
export type Trip = {
  schemaVersion: 3;
  coordinateSystem: 'GCJ-02';
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  travelers: number;
  updatedAt: string;
  days: Day[];
  links: GuideLink[];
  unscheduled: Stop[];
};
export type RouteRecord = {
  key: string;
  from: XY;
  to: XY;
  policy: 0;
  distanceKm: number;
  drivingMin: number;
  path: XY[];
  checkedAt: string;
  source: string;
};
export type RoadbookFile = Trip & { routeRecords: RouteRecord[] };
export type Snapshot = { trip: Trip; records: RouteRecord[]; revision: number };
export type RouteState = { status: 'loading' | 'error'; message?: string };
