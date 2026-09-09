import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, create } from 'react-test-renderer';
import { renderToString } from 'react-dom/server';
import { useEffect } from 'react';
import Link, { useSearchParams, useRouter } from '../lib/navigation';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
test('static navigation reads real day/stop parameters, switches dates and restores history', async () => {
  globalThis.window = new EventTarget();
  let current = new URL('https://roadbook.test/?day=d1&stop=first');
  let assigned;
  const address = {
    get href() {
      return current.href;
    },
    get origin() {
      return current.origin;
    },
    get pathname() {
      return current.pathname;
    },
    get search() {
      return current.search;
    },
    assign(value) {
      assigned = value;
    },
  };
  window.location = globalThis.location = address;
  globalThis.history = {
    state: { preserved: true },
    pushState(state, _, href) {
      assert.deepEqual(state, { preserved: true });
      current = new URL(href, current);
    },
  };
  let params, router, root;
  function Probe() {
    const value = useSearchParams(),
      navigation = useRouter();
    useEffect(() => {
      params = value;
      router = navigation;
    }, [value, navigation]);
    return (
      <>
        <output>
          {value.get('day')}/{value.get('stop')}
        </output>
        <Link href="/?day=d2">第二天</Link>
      </>
    );
  }
  // The server does not know the visitor's URL; hydration must then update it.
  assert.match(renderToString(<Probe />), /<output>\//);
  const original = console.error;
  console.error = (...args) => {
    if (!String(args[0]).startsWith('react-test-renderer is deprecated'))
      original(...args);
  };
  try {
    await act(async () => {
      root = create(<Probe />);
    });
    assert.equal(params.get('day'), 'd1');
    assert.equal(params.get('stop'), 'first');
    function click(href, overrides = {}) {
      const event = {
        button: 0,
        defaultPrevented: false,
        currentTarget: {
          href: new URL(href, current).href,
          target: '',
          hasAttribute: () => false,
        },
        preventDefault() {
          this.defaultPrevented = true;
        },
        ...overrides,
      };
      root.root.findByType('a').props.onClick(event);
      return event;
    }
    await act(async () => {
      assert.equal(click('/?day=d2').defaultPrevented, true);
    });
    assert.equal(params.get('day'), 'd2');
    assert.equal(params.get('stop'), null);
    await act(async () => {
      current = new URL('https://roadbook.test/?day=d1&stop=first');
      window.dispatchEvent(new Event('popstate'));
    });
    assert.equal(params.get('day'), 'd1');
    assert.equal(params.get('stop'), 'first');
    // Cross-page links remain real navigations, never RSC requests; modifier
    // clicks, anchors, downloads and an unsaved-form guard keep native behavior.
    for (const href of [
      '/map?day=d1',
      '/place?day=d1&stop=first',
      'https://example.com/',
      '/?day=d1#main-content',
    ]) {
      assert.equal(click(href).defaultPrevented, false);
    }
    for (const key of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
      assert.equal(click('/?day=d2', { [key]: true }).defaultPrevented, false);
    }
    click('/?day=d2', { defaultPrevented: true });
    assert.equal(params.get('day'), 'd1');
    router.push('/?day=d4');
    assert.equal(assigned, 'https://roadbook.test/?day=d4');
    assert.throws(() => router.push('javascript:alert(1)'), /路书/);
  } finally {
    if (root) await act(async () => root.unmount());
    console.error = original;
  }
});
