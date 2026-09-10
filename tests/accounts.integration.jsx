import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, create } from 'react-test-renderer';
import { AccountProvider } from '../features/accounts/provider';
import { useSearchParams } from '../lib/navigation';
import { selectedPage } from '../features/static-roadbook/data';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = Object.assign(new EventTarget(), {
  location: new URL('http://localhost:4173/?day=d2&view=route'),
  history: {
    replaceState(_state, _title, url) {
      window.location = new URL(url, window.location);
    },
  },
  setInterval,
  clearInterval,
  setTimeout,
  clearTimeout,
});

test('成员登录和邀请注册后进入同日期每日路书，失败登录不改变原地址', async () => {
  const originalLocation = window.location;
  const originalFetch = globalThis.fetch;
  const originalFormData = globalThis.FormData;
  const originalError = console.error;
  console.error = (...args) => {
    if (!String(args[0]).startsWith('react-test-renderer is deprecated'))
      originalError(...args);
  };
  globalThis.FormData = class {
    get(key) {
      return (
        {
          username: 'traveler',
          password: 'password-12345',
          confirm: 'password-12345',
        }[key] || ''
      );
    }
  };
  let root;
  function Page({ initialView }) {
    const { view, day } = selectedPage(useSearchParams(), initialView);
    return (
      <output>
        {view}:{day.id}
      </output>
    );
  }
  try {
    for (const [address, action, initialView] of [
      [
        '/?day=d2&view=account&stop=old&from=route&mapDay=d5',
        'login',
        'roadbook',
      ],
      ['/map?day=d4&view=route', 'login', 'route'],
      [
        '/?day=d3&view=account#account=invite&token=test-invite',
        'register',
        'roadbook',
      ],
    ]) {
      let user = null,
        rejectLogin = action === 'login';
      window.location = new URL(address, 'http://localhost:4173');
      globalThis.fetch = async (url) => {
        if (url.endsWith('/' + action)) {
          if (rejectLogin)
            return new Response(JSON.stringify({ error: '账号或密码错误' }), {
              status: 401,
            });
          user = { id: 'member', name: '马健航', role: 'member', avatar: '' };
        }
        return new Response(JSON.stringify({ adminConfigured: true, user }));
      };
      await act(async () => {
        root = create(
          <AccountProvider>
            <Page initialView={initialView} />
          </AccountProvider>,
        );
      });
      const submit = () =>
        root.root
          .findByType('form')
          .props.onSubmit({
            preventDefault() {},
            currentTarget: { reset() {} },
          });
      if (rejectLogin) {
        await act(submit);
        assert.equal(
          window.location.pathname + window.location.search,
          address,
        );
        assert.match(JSON.stringify(root.toJSON()), /账号或密码错误/);
        rejectLogin = false;
      }
      await act(submit);
      const day = new URL(address, 'http://localhost:4173').searchParams.get(
        'day',
      );
      assert.equal(window.location.pathname, '/');
      assert.equal(window.location.search, `?day=${day}&view=roadbook`);
      assert.equal(window.location.hash, '');
      assert.deepEqual(root.root.findByType('output').children, [
        'roadbook',
        ':',
        day,
      ]);
      await act(async () => {
        root.unmount();
        root = null;
      });
    }
  } finally {
    if (root) await act(async () => root.unmount());
    globalThis.FormData = originalFormData;
    window.location = originalLocation;
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});
globalThis.document = Object.assign(new EventTarget(), {
  visibilityState: 'visible',
});

test('同一登录入口按身份显示管理页或路书，退出后回到登录', async () => {
  let user = {
    id: 'admin-id',
    username: 'admin',
    name: '系统管理员',
    avatar: '',
    role: 'admin',
    disabled: false,
    createdAt: 1,
  };
  let root;
  const calls = [];
  const originalError = console.error;
  console.error = (...args) => {
    if (!String(args[0]).startsWith('react-test-renderer is deprecated'))
      originalError(...args);
  };
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (url.endsWith('/logout')) user = null;
    if (url === '/api/agent/admin/config')
      return new Response(
        JSON.stringify({
          baseUrl: '',
          model: '',
          embeddingModel: '',
          keyConfigured: false,
          ready: false,
          envManaged: [],
          servers: [],
          speech: {
            appId: '',
            keyConfigured: false,
            tokenConfigured: false,
            ready: false,
            envManaged: [],
          },
        }),
      );
    return new Response(
      JSON.stringify(
        url.endsWith('/members')
          ? { members: [], invites: [] }
          : { adminConfigured: true, user },
      ),
    );
  };
  const mount = async () => {
    await act(async () => {
      root = create(
        <AccountProvider>
          <div>成员专属路书</div>
        </AccountProvider>,
      );
    });
  };
  try {
    await mount();
    const adminPage = JSON.stringify(root.toJSON());
    assert.ok(adminPage.includes('成员管理'));
    assert.ok(adminPage.includes('生成邀请链接'));
    assert.ok(adminPage.includes('火山语音识别'));
    assert.ok(adminPage.includes('语音 API Key'));
    assert.ok(adminPage.includes('还没有旅行成员'));
    assert.ok(!adminPage.includes('成员专属路书'));
    assert.ok(!adminPage.includes('个人资料'));
    await act(async () => {
      await root.root
        .findAllByType('button')
        .find((b) => b.children.includes('退出管理'))
        .props.onClick();
    });
    assert.ok(JSON.stringify(root.toJSON()).includes('登录北行路书'));
    await act(async () => root.unmount());
    user = {
      id: 'member-id',
      username: 'traveler',
      name: '马健航',
      avatar: '',
      role: 'member',
      disabled: false,
      createdAt: 2,
    };
    calls.length = 0;
    await mount();
    assert.ok(JSON.stringify(root.toJSON()).includes('成员专属路书'));
    assert.ok(!calls.some((url) => url.endsWith('/members')));
    assert.equal(window.location.search, '?day=d2&view=route');
    await act(async () => window.dispatchEvent(new Event('account-expired')));
    assert.ok(JSON.stringify(root.toJSON()).includes('登录北行路书'));
    await act(async () => root.unmount());
    user = null;
    window.location.hash = '#account=setup&token=retired-token';
    await mount();
    assert.equal(window.location.hash, '');
    assert.ok(JSON.stringify(root.toJSON()).includes('初始化链接已停用'));
    assert.ok(!JSON.stringify(root.toJSON()).includes('创建管理员账号'));
  } finally {
    if (root) await act(async () => root.unmount());
    console.error = originalError;
  }
});
