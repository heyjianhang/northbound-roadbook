import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, create } from 'react-test-renderer';
import { AccountContext } from '../features/accounts/context';
import { ChatScreen } from '../features/agent/chat-screen';
import { SpeechInput } from '../features/agent/speech-input';
import { AssistantParts } from '../features/agent/message-parts';
import { Collapsible } from '../components/ui/collapsible';
import { Tool } from '../components/ai-elements/tool';
import { InputGroupButton } from '../components/ui/input-group';
import {
  PromptInput,
  PromptInputTextarea,
} from '../components/ai-elements/prompt-input';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = new EventTarget();
globalThis.document = Object.assign(new EventTarget(), {
  visibilityState: 'visible',
});

test('工具过程默认整体折叠，保留正文；流式追加、失败和结束不重置展开选择', async () => {
  const message = {
    id: 'tool-answer',
    role: 'assistant',
    authorId: 'a',
    authorName: '助手',
    status: 'running',
    text: '天气查询结果',
    createdAt: '2026-09-10T00:00:00Z',
    parts: [
      { type: 'text', text: '先看看天气。' },
      {
        type: 'tool',
        id: 'tool-1',
        name: 'read_roadbook',
        input: { day: 'd2' },
        state: 'output-available',
        output: '工具结果甲',
      },
      { type: 'text', text: '接着确认路线。' },
      {
        type: 'tool',
        id: 'tool-2',
        name: 'maps_weather',
        input: { city: '海拉尔' },
        state: 'input-available',
      },
      { type: 'text', text: '天气查询结果' },
    ],
  };
  let root;
  const text = () => JSON.stringify(root.toJSON());
  const outer = () =>
    root.root
      .findAllByType(Collapsible)
      .find((c) => c.props.className === 'not-prose min-w-0');
  try {
    await act(async () => {
      root = create(<AssistantParts message={message} />);
    });
    assert.equal(outer().props.open, false);
    assert.equal(root.root.findAllByType('button').length, 1);
    assert.match(text(), /处理中/);
    assert.match(text(), /天气查询结果/);
    assert.match(text(), /接着确认路线/);
    assert.ok(!text().includes('工具结果甲'));
    await act(async () => outer().props.onOpenChange(true));
    assert.equal(root.root.findAllByType(Tool).length, 2);
    const first = root.root.findAllByType(Tool)[0];
    assert.equal(first.props.defaultOpen, false);
    const updated = {
      ...message,
      parts: [
        ...message.parts,
        {
          type: 'tool',
          id: 'tool-3',
          name: 'maps_driving',
          input: {},
          state: 'output-error',
        },
      ],
    };
    await act(async () => root.update(<AssistantParts message={updated} />));
    assert.equal(outer().props.open, true);
    assert.equal(root.root.findAllByType(Tool).length, 3);
    assert.match(text(), /项失败/);
    await act(async () => outer().props.onOpenChange(false));
    await act(async () =>
      root.update(
        <AssistantParts message={{ ...updated, status: 'complete' }} />,
      ),
    );
    assert.equal(outer().props.open, false);
    assert.match(text(), /已处理/);
    assert.match(text(), /项失败/);
    for (const [status, label] of [
      ['stopped', '已停止'],
      ['interrupted', '已中断'],
      ['error', '处理失败'],
    ]) {
      await act(async () =>
        root.update(<AssistantParts message={{ ...updated, status }} />),
      );
      assert.match(text(), new RegExp(label));
      assert.ok(!text().includes('animate-spin'));
    }
    await act(async () =>
      root.update(
        <AssistantParts
          message={{ ...message, parts: [{ type: 'text', text: '只有正文' }] }}
        />,
      ),
    );
    assert.equal(root.root.findAllByType(Collapsible).length, 0);
    assert.match(text(), /只有正文/);
  } finally {
    if (root) await act(async () => root.unmount());
  }
});

test('AI Elements 使用共同对话，晚到的 HTTP 快照不覆盖流式结果，失败保留草稿', async () => {
  const streams = [];
  globalThis.EventSource = class {
    constructor(url) {
      this.url = url;
      streams.push(this);
    }
    addEventListener() {}
    close() {
      this.closed = true;
    }
    update(snapshot) {
      this.onmessage({ data: JSON.stringify(snapshot) });
    }
  };
  const initial = {
    revision: 1,
    ready: true,
    busy: false,
    memoryMode: 'keyword',
    messages: [],
  };
  let completeSend;
  globalThis.fetch = async (_url, options) =>
    _url === '/api/accounts/companions'
      ? new Response(
          JSON.stringify({
            companions: [{ id: 'b', name: '旅伴', avatar: '' }],
          }),
        )
      : options.method === 'POST'
        ? await new Promise((resolve) => {
            completeSend = resolve;
          })
        : new Response(JSON.stringify(initial));
  const session = {
    adminConfigured: true,
    user: { id: 'a', name: '健航', role: 'member', avatar: '' },
  };
  let root;
  const originalError = console.error;
  console.error = (...args) => {
    if (!String(args[0]).startsWith('react-test-renderer is deprecated'))
      originalError(...args);
  };
  try {
    await act(async () => {
      root = create(
        <AccountContext
          value={{ session, refresh: async () => {}, logout: async () => {} }}
        >
          <ChatScreen dayId="d2" />
        </AccountContext>,
      );
    });
    assert.match(JSON.stringify(root.toJSON()), /一起商量/);
    await act(async () =>
      root.root
        .findByType(PromptInputTextarea)
        .props.onChange({ target: { value: '今天怎么安排' } }),
    );
    let submitted;
    await act(async () => {
      submitted = root.root
        .findByType(PromptInput)
        .props.onSubmit({ text: '今天怎么安排' });
    });
    const message = {
      id: 'answer',
      role: 'user',
      authorId: 'b',
      authorName: '旅伴',
      text: '最新的共享消息',
      parts: [],
      status: 'complete',
      createdAt: '2026-09-09T00:00:00Z',
    };
    await act(async () => {
      streams[0].update({ ...initial, revision: 3, messages: [message] });
      completeSend(
        new Response(JSON.stringify({ ...initial, revision: 2, busy: true })),
      );
      await submitted;
    });
    assert.match(JSON.stringify(root.toJSON()), /最新的共享消息/);
    assert.equal(root.root.findByType(PromptInputTextarea).props.value, '');
    assert.ok(!JSON.stringify(root.toJSON()).includes('我的对话'));
    assert.equal(streams.length, 1);
    await act(async () =>
      root.root
        .findByType(PromptInputTextarea)
        .props.onChange({ target: { value: '我们的偏好' } }),
    );
    let failed;
    await act(async () => {
      failed = root.root
        .findByType(PromptInput)
        .props.onSubmit({ text: '我们的偏好' })
        .catch(() => {});
    });
    await act(async () => {
      completeSend(
        new Response(JSON.stringify({ error: '测试网络故障' }), {
          status: 502,
        }),
      );
      await failed;
    });
    assert.equal(
      root.root.findByType(PromptInputTextarea).props.value,
      '我们的偏好',
    );
    assert.match(JSON.stringify(root.toJSON()), /测试网络故障/);
    assert.ok(!JSON.stringify(root.toJSON()).includes('所有旅伴可见'));
    assert.ok(
      root.root.findAll((node) => node.props['data-author'] === 'companion')
        .length > 0,
    );
    await act(async () =>
      root.root.findByType(SpeechInput).props.onText('明天想吃当地菜'),
    );
    assert.equal(
      root.root.findByType(PromptInputTextarea).props.value,
      '我们的偏好\n明天想吃当地菜',
    );
  } finally {
    if (root) await act(async () => root.unmount());
    console.error = originalError;
  }
});

test('语音停止后回填文字，取消忽略晚到结果，权限取消与离开页面释放麦克风', async () => {
  const mediaDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    'mediaDevices',
  );
  const originalRecorder = globalThis.MediaRecorder,
    originalDecoder = globalThis.OfflineAudioContext;
  const tracks = [],
    texts = [],
    errors = [],
    statuses = [],
    requests = [];
  let getStream;
  const makeStream = () => {
    const track = Object.assign(new EventTarget(), {
      stopped: false,
      stop() {
        this.stopped = true;
      },
    });
    tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  };
  getStream = async () => makeStream();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: () => getStream() },
  });
  window.isSecureContext = true;
  globalThis.MediaRecorder = class {
    state = 'inactive';
    mimeType = 'audio/webm';
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        this.ondataavailable({ data: new Blob(['browser-audio']) });
        this.onstop();
      });
    }
  };
  globalThis.OfflineAudioContext = class {
    async decodeAudioData() {
      return {
        numberOfChannels: 1,
        sampleRate: 16000,
        getChannelData: () => new Float32Array(16000),
      };
    }
  };
  globalThis.fetch = async (url, options) =>
    new Promise((resolve) => requests.push({ url, options, resolve }));
  let root;
  const click = (label) =>
    root.root
      .findAllByType(InputGroupButton)
      .find((button) => button.props['aria-label'] === label)
      .props.onClick();
  const originalError = console.error;
  console.error = (...args) => {
    if (!String(args[0]).startsWith('react-test-renderer is deprecated'))
      originalError(...args);
  };
  try {
    await act(async () => {
      root = create(
        <SpeechInput
          ready
          onText={(text) => texts.push(text)}
          onError={(text) => errors.push(text)}
          onActiveChange={(value) => statuses.push(value)}
        />,
      );
    });
    assert.equal(tracks.length, 0);
    await act(async () => click('语音输入'));
    assert.equal(tracks[0].stopped, false);
    await act(async () => click('结束录音并识别'));
    assert.equal(tracks[0].stopped, true);
    assert.equal(requests[0].url, '/api/agent/speech');
    assert.equal(requests[0].options.body.type, 'audio/wav');
    assert.equal(requests[0].options.body.size, 32044);
    await act(async () =>
      requests[0].resolve(
        new Response(JSON.stringify({ text: '明天去看日落。' })),
      ),
    );
    assert.deepEqual(texts, ['明天去看日落。']);
    assert.equal(statuses.at(-1), false);
    await act(async () => click('语音输入'));
    await act(async () => click('结束录音并识别'));
    await act(async () => click('取消语音输入'));
    assert.equal(requests[1].options.signal.aborted, true);
    await act(async () =>
      requests[1].resolve(new Response(JSON.stringify({ text: '不应该回填' }))),
    );
    assert.deepEqual(texts, ['明天去看日落。']);
    let grant;
    getStream = () =>
      new Promise((resolve) => {
        grant = resolve;
      });
    await act(async () => click('语音输入'));
    await act(async () => click('取消语音输入'));
    await act(async () => grant(makeStream()));
    assert.equal(tracks.at(-1).stopped, true);
    getStream = async () => {
      throw new DOMException('denied', 'NotAllowedError');
    };
    await act(async () => click('语音输入'));
    assert.match(errors.at(-1), /麦克风权限未开启/);
    getStream = async () => makeStream();
    await act(async () => click('语音输入'));
    await act(async () => {
      document.visibilityState = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(tracks.at(-1).stopped, true);
    document.visibilityState = 'visible';
    await act(async () => click('语音输入'));
    await act(async () => {
      root.unmount();
      root = null;
    });
    assert.ok(tracks.every((track) => track.stopped));
    assert.equal(requests.length, 2);
  } finally {
    if (root) await act(async () => root.unmount());
    console.error = originalError;
    globalThis.MediaRecorder = originalRecorder;
    globalThis.OfflineAudioContext = originalDecoder;
    if (mediaDescriptor)
      Object.defineProperty(navigator, 'mediaDevices', mediaDescriptor);
    else delete navigator.mediaDevices;
    document.visibilityState = 'visible';
  }
});

test('内置 MCP 配置展示连接状态，修改目标清除旧凭据与工具选择', async () => {
  const { McpSettings } = await import('../features/agent/mcp-settings');
  const { NativeSelect } = await import('../components/ui/native-select');
  const { Input } = await import('../components/ui/input');
  const { Button } = await import('../components/ui/button');
  const servers = [
    {
      id: 'amap',
      name: '高德地图与天气',
      builtin: true,
      transport: 'sse',
      url: 'https://example.test/sse',
      tokenConfigured: true,
      enabled: true,
      tools: ['amap_weather'],
      headers: [{ name: 'X-Key', configured: true }],
      discovery: {
        tools: [
          { name: 'amap_weather', description: '查询天气', readOnly: true },
        ],
        error: '',
        checkedAt: 'now',
      },
    },
    {
      id: 'fliggy',
      name: '飞猪旅行',
      builtin: true,
      transport: 'stdio',
      url: '',
      enabled: false,
      tools: [],
      proxyApproved: false,
    },
  ];
  let changed, root;
  try {
    await act(async () => {
      root = create(
        <McpSettings
          servers={servers}
          busy={false}
          setBusy={() => {}}
          change={(value) => {
            changed = value;
          }}
          save={async () => ({ servers })}
        />,
      );
    });
    const rendered = JSON.stringify(root.toJSON());
    assert.match(rendered, /高德地图与天气/);
    assert.match(rendered, /已启用/);
    assert.match(rendered, /接入方式待确认/);
    assert.equal(
      root.root
        .findAllByType(Button)
        .filter((b) => b.props['aria-label']?.startsWith('移除')).length,
      0,
    );
    const password = root.root
      .findAllByType(Input)
      .find((i) => i.props['aria-label'] === '高德地图与天气 MCP 密钥');
    assert.equal(password.props.value, '');
    await act(async () =>
      root.root
        .findByType(NativeSelect)
        .props.onChange({ target: { value: 'streamable_http' } }),
    );
    assert.equal(changed[0].transport, 'streamable_http');
    assert.equal(changed[0].tokenConfigured, false);
    assert.equal(changed[0].enabled, false);
    assert.deepEqual(changed[0].tools, []);
    assert.deepEqual(changed[0].headers, []);
    assert.equal(changed[0].discovery, undefined);
  } finally {
    if (root) await act(async () => root.unmount());
  }
});
