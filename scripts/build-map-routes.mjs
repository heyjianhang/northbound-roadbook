import { readFile, writeFile } from 'node:fs/promises';
import { gcjToWgs } from './map-coordinates.mjs';
const read = async (path) =>
  JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const roadbook = await read('../data/roadbook.json');
const centers = await read('../data/map-centers.json');
const places = {};
for (const day of roadbook.days)
  for (const stop of day.stops) {
    const approximate = stop.lng === null || stop.lat === null;
    const gcj = approximate ? centers[stop.name]?.gcj02 : [stop.lng, stop.lat];
    if (!gcj) throw Error(`Missing coordinates: ${stop.name}`);
    places[stop.name] = { position: gcjToWgs(gcj), approximate };
  }
const days = [];
for (const day of roadbook.days) {
  const points = day.stops.map((stop) => places[stop.name].position);
  const url = `https://router.project-osrm.org/route/v1/driving/${points.map((p) => p.join(',')).join(';')}?overview=full&geometries=geojson&steps=false`;
  const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw Error(`OSRM ${day.id}: HTTP ${response.status}`);
  const data = await response.json();
  if (data.code !== 'Ok' || !data.routes?.[0])
    throw Error(`OSRM ${day.id}: ${data.code}`);
  const route = data.routes[0];
  days.push({
    id: day.id,
    path: route.geometry.coordinates,
    distanceKm: Math.round(route.distance / 1000),
    snapped: data.waypoints.map((p) => ({
      position: p.location,
      distance: p.distance,
    })),
  });
  console.log(
    `${day.id}: ${Math.round(route.distance / 1000)} km; ${route.geometry.coordinates.length} points; max snap ${Math.round(Math.max(...data.waypoints.map((p) => p.distance)))}m`,
  );
}
await writeFile(
  new URL('../data/map-routes.json', import.meta.url),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: 'OSRM / OpenStreetMap',
    coordinateSystem: 'WGS84',
    places,
    days,
  }) + '\n',
);
