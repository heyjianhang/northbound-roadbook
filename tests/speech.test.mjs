import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeSpeechWav } from '../features/agent/speech-recorder.ts';
import { transcribeSpeech, validateSpeechAudio } from '../scripts/speech.mjs';
import { openAgentStore } from '../scripts/agent-store.mjs';

const audio = async () =>
  Buffer.from(
    await encodeSpeechWav([new Float32Array(16000)], 16000).arrayBuffer(),
  );
test('浏览器音频混为单声道，WAV 参数、正负幅值及最长时长正确', async () => {
  const left = new Float32Array(16000),
    right = new Float32Array(16000);
  left.set([1, -1, 1, 2]);
  right.set([1, -1, -1, 2]);
  const wav = Buffer.from(
    await encodeSpeechWav([left, right], 16000).arrayBuffer(),
  );
  validateSpeechAudio(wav);
  assert.equal(wav.length, 32044);
  assert.deepEqual(
    [0, 1, 2, 3].map((i) => wav.readInt16LE(44 + i * 2)),
    [32767, -32768, 0, 32767],
  );
  const max = Buffer.from(
    await encodeSpeechWav([new Float32Array(16000 * 61)], 16000).arrayBuffer(),
  );
  validateSpeechAudio(max);
  assert.equal(max.length, 44 + 16000 * 60 * 2);
  assert.throws(() => encodeSpeechWav([new Float32Array(10)], 16000), /太短/);
  assert.throws(() => encodeSpeechWav([left], 48000), /格式无效/);
  wav.writeUInt32LE(44100, 24);
  assert.throws(() => validateSpeechAudio(wav), /格式无效/);
});

test('火山新旧控制台鉴权、固定极速资源、Base64 音频与识别结果符合协议', async () => {
  const wav = await audio();
  for (const config of [
    { apiKey: 'new-key', appId: 'ignored', accessToken: 'ignored' },
    { appId: 'old-app', accessToken: 'old-token' },
  ]) {
    const result = await transcribeSpeech(
      wav,
      config,
      'member-1',
      new AbortController().signal,
      async (url, options) => {
        assert.equal(
          url,
          'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash',
        );
        assert.equal(options.redirect, 'error');
        assert.equal(
          options.headers['X-Api-Resource-Id'],
          'volc.bigasr.auc_turbo',
        );
        assert.equal(options.headers['X-Api-Sequence'], '-1');
        assert.match(options.headers['X-Api-Request-Id'], /^[a-f0-9-]{36}$/);
        if (config.apiKey) {
          assert.equal(options.headers['X-Api-Key'], 'new-key');
          assert.equal(options.headers['X-Api-Access-Key'], undefined);
        } else {
          assert.equal(options.headers['X-Api-Key'], undefined);
          assert.equal(options.headers['X-Api-App-Key'], 'old-app');
          assert.equal(options.headers['X-Api-Access-Key'], 'old-token');
        }
        const body = JSON.parse(options.body);
        assert.deepEqual(Buffer.from(body.audio.data, 'base64'), wav);
        assert.equal(body.audio.url, undefined);
        assert.equal(body.user.uid, 'member-1');
        assert.equal(body.request.model_name, 'bigmodel');
        return new Response(
          JSON.stringify({ result: { text: ' 明天去看日落。 ' } }),
          { headers: { 'X-Api-Status-Code': '20000000' } },
        );
      },
    );
    assert.equal(result, '明天去看日落。');
  }
});

test('静音、服务错误、空结果和取消有明确结果，不透传上游密钥或错误正文', async () => {
  const wav = await audio(),
    config = { apiKey: 'private-key' };
  for (const [http, code, message] of [
    [200, '20000003', /说话声/],
    [403, '', /鉴权失败/],
    [429, '', /繁忙/],
    [200, '45000001', /识别失败/],
    [500, '', /识别失败/],
  ]) {
    await assert.rejects(
      transcribeSpeech(
        wav,
        config,
        'a',
        new AbortController().signal,
        async () =>
          new Response('private-key', {
            status: http,
            headers: { 'X-Api-Status-Code': code },
          }),
      ),
      message,
    );
  }
  await assert.rejects(
    transcribeSpeech(
      wav,
      config,
      'a',
      new AbortController().signal,
      async () =>
        new Response('{"result":{"text":""}}', {
          headers: { 'X-Api-Status-Code': '20000000' },
        }),
    ),
    /说话声/,
  );
  await assert.rejects(
    transcribeSpeech(
      wav,
      config,
      'a',
      new AbortController().signal,
      async () => {
        throw new Error('private-key');
      },
    ),
    /暂时无法连接/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    transcribeSpeech(
      wav,
      config,
      'a',
      controller.signal,
      async (_url, options) => {
        options.signal.throwIfAborted();
      },
    ),
    /已取消/,
  );
});

test('语音配置持久化和环境覆盖，公开配置隐藏两种密钥并拦截请求头注入', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'roadbook-speech-'));
  let store;
  try {
    store = openAgentStore({ AGENT_DATA_DIR: directory });
    store.saveConfig({
      baseUrl: '',
      model: '',
      embeddingModel: '',
      servers: [],
      speech: { apiKey: 'saved-key', appId: 'app', accessToken: 'saved-token' },
    });
    assert.throws(
      () =>
        store.saveConfig({
          ...store.publicConfig(),
          speech: { apiKey: 'bad\r\nheader' },
        }),
      /凭据无效/,
    );
    store.close();
    store = openAgentStore({
      AGENT_DATA_DIR: directory,
      VOLC_SPEECH_API_KEY: 'env-key',
    });
    assert.equal(store.config().speech.apiKey, 'env-key');
    assert.equal(store.config().speech.accessToken, 'saved-token');
    const config = store.publicConfig();
    assert.deepEqual(config.speech.envManaged, ['apiKey']);
    assert.equal(config.speech.ready, true);
    assert.ok(!JSON.stringify(config).includes('saved-key'));
    assert.ok(!JSON.stringify(config).includes('saved-token'));
    assert.ok(!JSON.stringify(config).includes('env-key'));
    // Older configuration clients preserve speech when they omit that section.
    const { speech: _speech, ...oldConfig } = config;
    store.saveConfig(oldConfig);
    assert.equal(store.config().speech.accessToken, 'saved-token');
  } finally {
    store?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
