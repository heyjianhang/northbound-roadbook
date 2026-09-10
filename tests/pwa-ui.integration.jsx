import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, create } from 'react-test-renderer';
import { PwaProvider } from '../pwa/register';
import { InstallCard } from '../pwa/install-card';
import { mobilePlatform } from '../lib/mobile-platform';
import { xiaohongshuLinks } from '../lib/xiaohongshu-links';
import posts from '../data/place-posts.json';
import { PostLink } from '../features/static-roadbook/post-link';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
test('小红书移动入口保持帖子和参数；网页与原生 App 地址分别可用', () => {
  for (const list of Object.values(posts))
    for (const post of list) {
      const links = xiaohongshuLinks(post.url, post.id);
      const original = new URL(post.url);
      assert.equal(
        new URL(links.mobile).pathname,
        `/discovery/item/${post.id}`,
      );
      assert.equal(new URL(links.app).protocol, 'xhsdiscover:');
      assert.equal(new URL(links.app).host, 'item');
      assert.equal(new URL(links.app).pathname, `/${post.id}`);
      for (const url of Object.values(links))
        assert.equal(new URL(url).search, original.search);
    }
  assert.throws(() => xiaohongshuLinks('https://evil.test/explore/abc', 'abc'));
  assert.throws(() =>
    xiaohongshuLinks(posts['海拉尔'][0].url, posts['沈阳'][0].id),
  );
  assert.equal(
    mobilePlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 15)' }),
    'android',
  );
  assert.equal(
    mobilePlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0)' }),
    'ios',
  );
  assert.equal(
    mobilePlatform({
      userAgent: 'Macintosh',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    }),
    'ios',
  );
  assert.equal(
    mobilePlatform({
      userAgent: 'Macintosh',
      platform: 'MacIntel',
      maxTouchPoints: 0,
    }),
    'desktop',
  );
});

test('手机帖子卡片本身直达 App，不经过弹窗或新窗口', async () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const post = posts['海拉尔'][0];
  let root;
  try {
    for (const ua of ['Android', 'iPhone', 'Macintosh']) {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { userAgent: ua, maxTouchPoints: 0 },
      });
      await act(async () => {
        root = create(<PostLink post={post} />);
      });
      const anchors = root.root.findAllByType('a');
      assert.equal(anchors.length, 1);
      const url = new URL(anchors[0].props.href);
      assert.equal(
        url.protocol,
        ua === 'Macintosh' ? 'https:' : 'xhsdiscover:',
      );
      assert.equal(
        anchors[0].props.target,
        ua === 'Macintosh' ? '_blank' : '_self',
      );
      assert.equal(url.search, new URL(post.url).search);
      assert.equal(anchors[0].props.onClick, undefined);
      assert.equal(root.root.findAllByType('button').length, 0);
      await act(async () => root.unmount());
      root = null;
    }
  } finally {
    if (root) await act(async () => root.unmount());
    if (prior) Object.defineProperty(globalThis, 'navigator', prior);
    else delete globalThis.navigator;
  }
});

test('安装按钮消费安卓系统事件，取消不误报成功；iPhone 给出手动步骤，独立模式显示已安装', async () => {
  const prior = Object.fromEntries(
    ['window', 'document', 'navigator', 'matchMedia'].map((k) => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ]),
  );
  let root;
  const mount = async (ua, standalone = false) => {
    const media = Object.assign(new EventTarget(), { matches: standalone });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { userAgent: ua, platform: '', maxTouchPoints: 1 },
    });
    globalThis.document = Object.assign(new EventTarget(), {
      visibilityState: 'visible',
    });
    globalThis.window = Object.assign(new EventTarget(), {
      isSecureContext: true,
    });
    globalThis.matchMedia = () => media;
    await act(async () => {
      root = create(
        <PwaProvider>
          <InstallCard />
        </PwaProvider>,
      );
    });
    return media;
  };
  const button = () =>
    root.root
      .findAllByType('button')
      .find((b) => typeof b.props.onClick === 'function');
  const text = () => JSON.stringify(root.toJSON());
  try {
    await mount('Android');
    let prompts = 0;
    const event = Object.assign(
      new Event('beforeinstallprompt', { cancelable: true }),
      {
        prompt: async () => {
          prompts++;
        },
        userChoice: Promise.resolve({ outcome: 'dismissed' }),
      },
    );
    await act(async () => window.dispatchEvent(event));
    assert.equal(event.defaultPrevented, true);
    await act(async () => button().props.onClick());
    assert.equal(prompts, 1);
    assert.ok(text().includes('已取消安装'));
    assert.ok(!text().includes('已确认安装'));
    await act(async () => button().props.onClick());
    assert.equal(prompts, 1);
    await act(async () => root.unmount());
    await mount('iPhone');
    await act(async () => button().props.onClick());
    assert.ok(text().includes('Safari'));
    assert.ok(text().includes('添加到主屏幕'));
    await act(async () => root.unmount());
    const media = await mount('Android', true);
    assert.ok(text().includes('已从主屏幕打开'));
    assert.equal(button().props.disabled, true);
    media.matches = false;
    await act(async () => window.dispatchEvent(new Event('pageshow')));
    assert.equal(button().props.disabled, false);
    await act(async () => root.unmount());
    root = null;
  } finally {
    if (root) await act(async () => root.unmount());
    for (const [key, value] of Object.entries(prior))
      if (value) Object.defineProperty(globalThis, key, value);
      else delete globalThis[key];
  }
});
