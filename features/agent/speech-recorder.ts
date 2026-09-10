export type VoiceRecording = { stop: () => Promise<Blob>; cancel: () => void };

export function encodeSpeechWav(channels: Float32Array[], sampleRate: number) {
  if (
    sampleRate !== 16000 ||
    !channels.length ||
    channels.some((channel) => channel.length !== channels[0].length)
  )
    throw new Error('录音格式无效，请重新录制');
  const length = Math.min(channels[0].length, 16000 * 60);
  if (length < 1600) throw new Error('录音太短，请说完后再结束');
  const buffer = new ArrayBuffer(44 + length * 2),
    view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++)
      view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  write(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    const sample = Math.max(
      -1,
      Math.min(
        1,
        channels.reduce((sum, channel) => sum + channel[i], 0) /
          channels.length,
      ),
    );
    view.setInt16(
      44 + i * 2,
      Math.round(sample * (sample < 0 ? 32768 : 32767)),
      true,
    );
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function startVoiceRecording(
  signal: AbortSignal,
  onFailure: (error: Error) => void,
): Promise<VoiceRecording> {
  if (!window.isSecureContext)
    throw new Error('语音输入需要通过 HTTPS 或本机 localhost 打开');
  if (
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder === 'undefined' ||
    typeof OfflineAudioContext === 'undefined'
  )
    throw new Error('当前浏览器不支持录音，请使用新版 Safari 或 Chrome');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const release = () => stream.getTracks().forEach((track) => track.stop());
  if (signal.aborted) {
    release();
    throw new DOMException('已取消', 'AbortError');
  }
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream);
  } catch (error) {
    release();
    throw error;
  }
  let finishing = false,
    bytes = 0;
  const chunks: Blob[] = [];
  let resolve!: (value: Blob) => void, reject!: (error: Error) => void;
  const recorded = new Promise<Blob>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // Recording errors can arrive before the user clicks stop.
  void recorded.catch(() => {});
  const cancel = () => {
    finishing = true;
    signal.removeEventListener('abort', cancel);
    if (recorder.state !== 'inactive') recorder.stop();
    release();
    chunks.length = 0;
    reject(new DOMException('已取消', 'AbortError'));
  };
  const fail = (message: string) => {
    const error = new Error(message);
    cancel();
    onFailure(error);
  };
  recorder.ondataavailable = (event) => {
    if (signal.aborted) return;
    bytes += event.data.size;
    if (bytes > 8 * 1024 * 1024) {
      fail('录音过大，请缩短后重试');
      return;
    }
    chunks.push(event.data);
  };
  recorder.onstop = () => {
    release();
    resolve(new Blob(chunks, { type: recorder.mimeType }));
  };
  recorder.onerror = () => fail('录音中断，请检查麦克风后重试');
  stream.getAudioTracks().forEach((track) =>
    track.addEventListener(
      'ended',
      () => {
        if (!finishing) fail('麦克风已断开，请重新录制');
      },
      { once: true },
    ),
  );
  signal.addEventListener('abort', cancel, { once: true });
  try {
    recorder.start(250);
  } catch (error) {
    cancel();
    throw error;
  }
  return {
    cancel,
    async stop() {
      finishing = true;
      if (recorder.state !== 'inactive') recorder.stop();
      release();
      const blob = await recorded;
      signal.throwIfAborted();
      // Decode the browser's native WebM/MP4 recording and resample to 16 kHz.
      // OfflineAudioContext needs no live playback or additional audio permission.
      const decoder = new OfflineAudioContext(1, 1, 16000);
      let decoded: AudioBuffer;
      try {
        decoded = await decoder.decodeAudioData(await blob.arrayBuffer());
      } catch {
        throw new Error('无法读取本次录音，请重新录制或更新浏览器');
      }
      signal.throwIfAborted();
      signal.removeEventListener('abort', cancel);
      return encodeSpeechWav(
        Array.from({ length: decoded.numberOfChannels }, (_, i) =>
          decoded.getChannelData(i),
        ),
        decoded.sampleRate,
      );
    },
  };
}
