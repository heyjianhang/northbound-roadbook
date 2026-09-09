import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  roadbook,
  selectedPage,
  pageUrl,
  amapLink,
  mapPlaceUrl,
  placeBackUrl,
} from '../features/static-roadbook/data';
import { validateRoadbook } from '../lib/storage/import-export';
test('fixed roadbook validates and every day/stop is reachable through static index URLs', () => {
  assert.equal(validateRoadbook(roadbook).days.length, 6);
  assert.equal(selectedPage(new URLSearchParams()).day.id, 'd1');
  assert.equal(
    selectedPage(new URLSearchParams('day=unknown&view=unknown')).view,
    'roadbook',
  );
  for (const day of roadbook.days) {
    for (const stop of day.stops) {
      const url = new URL(
        pageUrl('place', day.id, stop.id),
        'https://roadbook.test',
      );
      assert.equal(url.pathname, '/');
      assert.equal(selectedPage(url.searchParams).day.id, day.id);
      assert.equal(selectedPage(url.searchParams).stop.id, stop.id);
      assert.equal(selectedPage(url.searchParams).view, 'place');
    }
  }
});
test('fixed locations open AMap navigation; broad areas open keyword search without invented coordinates', () => {
  for (const day of roadbook.days)
    for (const stop of day.stops) {
      const link = amapLink(stop),
        url = new URL(link.href);
      assert.equal(url.origin, 'https://uri.amap.com');
      assert.equal(url.searchParams.has('key'), false);
      assert.equal(url.searchParams.get('callnative'), '1');
      if (stop.lng === null) {
        assert.equal(url.pathname, '/search');
        assert.equal(url.searchParams.get('keyword'), stop.name);
        assert.equal(url.searchParams.has('to'), false);
      } else {
        assert.equal(url.pathname, '/navigation');
        assert.equal(
          url.searchParams.get('to'),
          `${stop.lng},${stop.lat},${stop.name}`,
        );
      }
    }
});

test('place back link respects map origin day, while roadbook and direct links stay on roadbook', () => {
  const url = new URL(
    mapPlaceUrl('d3', 'visit-7', 'd5'),
    'https://roadbook.test',
  );
  assert.equal(placeBackUrl(url.searchParams, 'd3'), pageUrl('route', 'd5'));
  assert.equal(
    placeBackUrl(new URLSearchParams('from=route&mapDay=invalid'), 'd3'),
    pageUrl('route', 'd3'),
  );
  assert.equal(
    placeBackUrl(new URLSearchParams('from=https://evil.test'), 'd3'),
    pageUrl('roadbook', 'd3'),
  );
  assert.equal(
    placeBackUrl(new URLSearchParams(), 'd3'),
    pageUrl('roadbook', 'd3'),
  );
});
