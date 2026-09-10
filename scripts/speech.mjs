import { randomUUID } from 'node:crypto';
import { AccountError, requireValue } from './accounts-store.mjs';

const endpoint =
  'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash';
const maxAudioBytes = 44 + 16000 * 2 * 60;
export const speechReady = (config) =>
  Boolean(config?.apiKey || (config?.appId && config?.accessToken));

// The browser normalizes recordings to this single format; do not accept arbitrary uploads or URLs.
export function validateSpeechAudio(audio) {
  requireValue(
    audio.length >= 44 + 3200 && audio.length <= maxAudioBytes,
    400,
    '请录制 0.1–60 秒的语音',
  );
  requireValue(
    audio.toString('ascii', 0, 4) === 'RIFF' &&
      audio.readUInt32LE(4) === audio.length - 8 &&
      audio.toString('ascii', 8, 16) === 'WAVEfmt ' &&
      audio.readUInt32LE(16) === 16 &&
      audio.readUInt16LE(20) === 1 &&
      audio.readUInt16LE(22) === 1 &&
      audio.readUInt32LE(24) === 16000 &&
      audio.readUInt32LE(28) === 32000 &&
      audio.readUInt16LE(32) === 2 &&
      audio.readUInt16LE(34) === 16 &&
      audio.toString('ascii', 36, 40) === 'data' &&
      audio.readUInt32LE(40) === audio.length - 44 &&
      audio.length % 2 === 0,
    400,
    '录音格式无效，请重新录制',
  );
}

export async function readSpeechAudio(req) {
  requireValue(
    req.headers['content-type']?.split(';')[0] === 'audio/wav',
    415,
    '仅支持页面录制的 WAV 音频',
  );
  requireValue(!req.headers['content-encoding'], 415, '不支持压缩上传');
  requireValue(
    !(Number(req.headers['content-length']) > maxAudioBytes),
    413,
    '每次最多录制 60 秒',
  );
  let size = 0;
  const chunks = [];
  // destroyOnReturn=false keeps the HTTP response writable when the body exceeds the limit.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    requireValue(size <= maxAudioBytes, 413, '每次最多录制 60 秒');
    chunks.push(chunk);
  }
  const audio = Buffer.concat(chunks);
  validateSpeechAudio(audio);
  return audio;
}

export async function transcribeSpeech(
  audio,
  config,
  userId,
  signal,
  fetcher = fetch,
) {
  requireValue(speechReady(config), 503, '请管理员先配置火山语音识别');
  validateSpeechAudio(audio);
  const timeout = AbortSignal.timeout(45000);
  let response;
  try {
    signal.throwIfAborted();
    response = await fetcher(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.any([signal, timeout]),
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey
          ? { 'X-Api-Key': config.apiKey }
          : {
              'X-Api-App-Key': config.appId,
              'X-Api-Access-Key': config.accessToken,
            }),
        'X-Api-Resource-Id': 'volc.bigasr.auc_turbo',
        'X-Api-Request-Id': randomUUID(),
        'X-Api-Sequence': '-1',
      },
      body: JSON.stringify({
        user: { uid: userId },
        audio: { data: audio.toString('base64') },
        request: {
          model_name: 'bigmodel',
          enable_itn: true,
          enable_punc: true,
        },
      }),
    });
    const code = response.headers.get('X-Api-Status-Code');
    if (response.status === 401 || response.status === 403)
      throw new AccountError(
        502,
        '火山语音鉴权失败，请管理员检查凭据及极速识别服务权限',
      );
    if (response.status === 429 || code === '55000031')
      throw new AccountError(503, '语音服务繁忙，请稍后再试');
    if (code === '20000003' || code === '45000002')
      throw new AccountError(422, '没有识别到说话声，请靠近麦克风再试');
    requireValue(
      response.ok && code === '20000000',
      502,
      '火山语音识别失败，请管理员检查服务配置或稍后重试',
    );
    // Bound the provider response as well as the upload; raw provider errors are never returned.
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      requireValue(size <= 1024 * 1024, 502, '语音识别结果过大，请缩短录音');
      chunks.push(chunk);
    }
    const text = JSON.parse(Buffer.concat(chunks).toString()).result?.text;
    requireValue(
      typeof text === 'string' && text.trim(),
      422,
      '没有识别到说话声，请靠近麦克风再试',
    );
    requireValue(text.length <= 12000, 502, '语音识别结果过长，请缩短录音');
    return text.trim();
  } catch (error) {
    if (error instanceof AccountError) throw error;
    if (signal.aborted) throw new AccountError(499, '语音识别已取消');
    if (timeout.aborted)
      throw new AccountError(504, '语音识别超时，请稍后再试');
    throw new AccountError(502, '暂时无法连接火山语音服务，请稍后再试');
  } finally {
    await response?.body?.cancel().catch(() => {});
  }
}
