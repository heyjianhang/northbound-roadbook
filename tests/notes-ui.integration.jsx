import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, create } from 'react-test-renderer';
import { PlaceNote } from '../features/notes/place-note';
import { PlaceTabs } from '../features/static-roadbook/place-tabs';
import { NoteMarkdown } from '../features/notes/markdown';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Tabs } from '../components/ui/tabs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = new EventTarget();
globalThis.document = Object.assign(new EventTarget(), {
  visibilityState: 'visible',
});
window.location = new URL(
  'http://localhost/?day=d2&view=place&stop=visit-3&from=route&mapDay=d5',
);
window.history = {
  state: {},
  pushState(_state, _title, url) {
    window.location = new URL(url, window.location.href);
  },
};
const note = {
  placeId: 'visit-2',
  name: '海拉尔',
  days: ['d1', 'd2', 'd5', 'd6'],
  content: '# 海拉尔\n\n原来的计划',
  version: 1,
  updatedBy: 'a',
  updatedName: '健航',
  updatedAt: '2026-09-09T10:00:00Z',
};
const label = (button) =>
  [button.props.children]
    .flat()
    .filter((value) => typeof value === 'string')
    .join('');
const button = (root, text) =>
  root.root.findAllByType(Button).find((b) => label(b) === text);

test('Markdown 展示标题、列表和链接，不执行 HTML 或危险 URL', async () => {
  let root;
  try {
    await act(async () => {
      root = create(
        <NoteMarkdown
          content={
            '# 海拉尔\n\n- **手把肉**\n- 奶茶\n\n[攻略](https://example.com/guide)\n\n[危险](javascript:alert(1))\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1) />'
          }
        />,
      );
    });
    assert.equal(root.root.findByType('h1').children.join(''), '海拉尔');
    assert.equal(root.root.findAllByType('li').length, 2);
    assert.ok(
      root.root
        .findAllByType('span')
        .some(
          (node) =>
            node.props['data-streamdown'] === 'strong' &&
            node.children.join('') === '手把肉',
        ),
    );
    const links = root.root.findAllByType('a');
    assert.ok(
      links.some((node) => node.props.href === 'https://example.com/guide'),
    );
    assert.ok(links.every((node) => !node.props.href?.includes('javascript:')));
    assert.equal(root.root.findAllByType('script').length, 0);
    assert.equal(root.root.findAllByType('img').length, 0);
  } finally {
    if (root) await act(async () => root.unmount());
  }
});

test('保存失败保留 Markdown 草稿，成功后退出编辑并显示共享版本', async () => {
  let root,
    fail = true;
  const posts = [];
  globalThis.fetch = async (_url, options) => {
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      posts.push(body);
      return fail
        ? new Response(JSON.stringify({ error: '网络暂时不可用' }), {
            status: 502,
          })
        : new Response(
            JSON.stringify({
              ok: true,
              note: { ...note, content: body.content, version: 2 },
            }),
          );
    }
    return new Response(JSON.stringify({ ok: true, note }));
  };
  try {
    await act(async () => {
      root = create(<PlaceNote stopId="visit-3" active />);
    });
    await act(async () => button(root, '编辑').props.onClick());
    await act(async () =>
      root.root
        .findByType(Textarea)
        .props.onChange({ target: { value: '# 新计划\n\n十点出发' } }),
    );
    await act(async () => {
      button(root, '保存笔记').props.onClick();
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.equal(
      root.root.findByType(Textarea).props.value,
      '# 新计划\n\n十点出发',
    );
    assert.match(JSON.stringify(root.toJSON()), /网络暂时不可用/);
    fail = false;
    await act(async () => {
      button(root, '保存笔记').props.onClick();
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.equal(root.root.findAllByType(Textarea).length, 0);
    assert.match(JSON.stringify(root.toJSON()), /笔记已保存/);
    assert.equal(posts.length, 2);
    assert.equal(posts[1].expectedVersion, 1);
    assert.equal(posts[1].placeId, 'visit-3');
    assert.ok(!('user' in posts[1]));
  } finally {
    if (root) await act(async () => root.unmount());
  }
});

test('远端更新不覆盖正在编辑的草稿，冲突阻止旧版本保存', async () => {
  let root,
    remote = note;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: true, note: remote }));
  try {
    await act(async () => {
      root = create(<PlaceNote stopId="visit-3" active />);
    });
    await act(async () => button(root, '编辑').props.onClick());
    await act(async () =>
      root.root
        .findByType(Textarea)
        .props.onChange({ target: { value: '我的草稿' } }),
    );
    remote = { ...note, version: 2, content: '旅伴的新计划' };
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.equal(root.root.findByType(Textarea).props.value, '我的草稿');
    assert.match(JSON.stringify(root.toJSON()), /笔记已有新版本/);
    assert.equal(button(root, '保存笔记').props.disabled, true);
    await act(async () => button(root, '放弃草稿，载入最新').props.onClick());
    assert.equal(root.root.findByType(Textarea).props.value, '旅伴的新计划');
    assert.equal(button(root, '保存笔记').props.disabled, false);
  } finally {
    if (root) await act(async () => root.unmount());
  }
});

test('帖子/笔记标签保留返回路线参数，切换后恢复编辑草稿', async () => {
  let root;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: true, note }));
  try {
    await act(async () => {
      root = create(
        <PlaceTabs stopId="visit-3">
          <p>原有帖子</p>
        </PlaceTabs>,
      );
    });
    const outer = () => root.root.findAllByType(Tabs)[0];
    assert.equal(outer().props.value, 'posts');
    await act(async () => {
      outer().props.onValueChange('notes');
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.equal(outer().props.value, 'notes');
    assert.equal(window.location.search.includes('mapDay=d5'), true);
    assert.equal(window.location.search.includes('tab=notes'), true);
    await act(async () => button(root, '编辑').props.onClick());
    await act(async () =>
      root.root
        .findByType(Textarea)
        .props.onChange({ target: { value: '切换时的草稿' } }),
    );
    await act(async () => outer().props.onValueChange('posts'));
    await act(async () => outer().props.onValueChange('notes'));
    assert.equal(root.root.findByType(Textarea).props.value, '切换时的草稿');
  } finally {
    if (root) await act(async () => root.unmount());
  }
});
