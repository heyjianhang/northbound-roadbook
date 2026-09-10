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
import placePosts from '../data/place-posts.json';
import seedTrip from '../data/seed-trip.json';
import seed from '../lib/seed.json';

test('Xiaohongshu references use cross-device detail links with their original access parameters', () => {
  const byId = new Map();
  for (const posts of Object.values(placePosts)) {
    for (const post of posts) {
      const url = new URL(post.url);
      assert.equal(url.origin, 'https://www.xiaohongshu.com');
      // The desktop search_result route returns an error page on iPhone,
      // even with HTTP 200. The detail route redirects to the mobile page.
      assert.equal(url.pathname, `/explore/${post.id}`);
      assert.ok(url.searchParams.get('xsec_token'));
      assert.ok(url.searchParams.get('xsec_source'));
      if (byId.has(post.id)) assert.equal(post.url, byId.get(post.id));
      byId.set(post.id, post.url);
    }
  }
  // General roadbook references must not fall back to a tokenless URL.
  for (const data of [roadbook, seedTrip, seed]) {
    const sources = JSON.stringify(data).match(
      /https:\/\/www\.xiaohongshu\.com\/[^"\s]+/g,
    );
    assert.ok(sources?.length);
    for (const source of sources) {
      const id = new URL(source).pathname.split('/').at(-1);
      assert.equal(source, byId.get(id));
    }
  }
});
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
      for (const platform of ['ios', 'android']) {
        const native = amapLink(stop, platform);
        const uri = new URL(native.href);
        assert.equal(native.target, '_self');
        assert.equal(
          uri.protocol,
          platform === 'ios' ? 'iosamap:' : 'androidamap:',
        );
        assert.equal(uri.searchParams.get('dev'), '0');
        assert.ok(uri.searchParams.get('sourceApplication'));
        assert.equal(uri.searchParams.has('key'), false);
        if (stop.lng === null) {
          assert.equal(uri.host, 'poi');
          assert.equal(
            uri.searchParams.get(platform === 'ios' ? 'name' : 'keywords'),
            `呼伦贝尔 ${stop.name}`,
          );
          assert.equal(uri.searchParams.has('lat'), false);
          assert.equal(uri.searchParams.has('lon'), false);
        } else {
          assert.equal(uri.host, 'navi');
          assert.equal(Number(uri.searchParams.get('lat')), stop.lat);
          assert.equal(Number(uri.searchParams.get('lon')), stop.lng);
          assert.equal(uri.searchParams.get('poiname'), stop.name);
        }
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
