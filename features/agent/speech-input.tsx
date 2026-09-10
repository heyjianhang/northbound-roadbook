'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, Square, X, Loader2 } from 'lucide-react';
import { InputGroupButton } from '@/components/ui/input-group';
import { startVoiceRecording, type VoiceRecording } from './speech-recorder';

type Props = {
  ready: boolean;
  disabled?: boolean;
  onText: (text: string) => void;
  onError: (text: string) => void;
  onActiveChange: (active: boolean) => void;
};
type Operation = {
  controller: AbortController;
  recording?: VoiceRecording;
  timer?: ReturnType<typeof setInterval>;
  finishing?: boolean;
};

export function SpeechInput(props: Props) {
  const [phase, setPhase] = useState<
    'idle' | 'requesting' | 'recording' | 'transcribing'
  >('idle');
  const [seconds, setSeconds] = useState(0);
  const active = useRef<Operation | null>(null),
    callbacks = useRef(props);
  useEffect(() => {
    callbacks.current = props;
  }, [props]);
  function dispose() {
    const op = active.current;
    active.current = null;
    if (op) {
      clearInterval(op.timer);
      op.controller.abort();
      op.recording?.cancel();
    }
  }
  function cancel() {
    dispose();
    setPhase('idle');
    callbacks.current.onActiveChange(false);
  }
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === 'hidden') cancel();
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', cancel);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', cancel);
      dispose();
    };
  }, []);
  function fail(op: Operation, error: unknown) {
    if (active.current !== op) return;
    const name = (error as Error).name;
    callbacks.current.onError(
      name === 'NotAllowedError'
        ? '麦克风权限未开启，请在浏览器的网站设置中允许录音'
        : name === 'NotFoundError'
          ? '没有找到麦克风，请连接后再试'
          : name === 'NotReadableError'
            ? '麦克风暂时无法使用，请关闭占用它的应用后重试'
            : name === 'TimeoutError'
              ? '语音识别超时，请稍后再试'
              : name === 'TypeError'
                ? '语音输入未完成，请检查网络后重试'
                : (error as Error).message || '录音失败，请重试',
    );
    cancel();
  }
  async function finish(op: Operation) {
    if (active.current !== op || !op.recording || op.finishing) return;
    op.finishing = true;
    clearInterval(op.timer);
    setPhase('transcribing');
    try {
      const audio = await op.recording.stop();
      op.controller.signal.throwIfAborted();
      const response = await fetch('/api/agent/speech', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'audio/wav' },
        body: audio,
        signal: AbortSignal.any([
          op.controller.signal,
          AbortSignal.timeout(65000),
        ]),
      });
      const data = (await response.json()) as { text?: string; error?: string };
      if (response.status === 401)
        window.dispatchEvent(new Event('account-expired'));
      if (!response.ok)
        throw new Error(data.error || '语音识别失败，请稍后再试');
      if (!data.text?.trim()) throw new Error('没有识别到说话声，请重新录制');
      if (active.current === op) {
        callbacks.current.onText(data.text);
        cancel();
      }
    } catch (error) {
      fail(op, error);
    }
  }
  async function start() {
    if (active.current) return;
    if (!props.ready) {
      props.onError('请管理员先在“旅行助手”中配置火山语音识别');
      return;
    }
    const op: Operation = { controller: new AbortController() };
    active.current = op;
    setPhase('requesting');
    setSeconds(0);
    props.onError('');
    props.onActiveChange(true);
    try {
      const recording = await startVoiceRecording(
        op.controller.signal,
        (error) => fail(op, error),
      );
      if (active.current !== op) {
        recording.cancel();
        return;
      }
      op.recording = recording;
      setPhase('recording');
      const began = performance.now();
      op.timer = setInterval(() => {
        const elapsed = Math.floor((performance.now() - began) / 1000);
        setSeconds(Math.min(60, elapsed));
        if (elapsed >= 60) void finish(op);
      }, 250);
    } catch (error) {
      fail(op, error);
    }
  }
  const recording = phase === 'recording';
  const label = recording
    ? '结束录音并识别'
    : phase === 'idle'
      ? '语音输入'
      : phase === 'requesting'
        ? '正在开启麦克风'
        : '正在识别语音';
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <InputGroupButton
        type="button"
        size="icon-sm"
        variant="ghost"
        className={
          recording ? 'rounded-full bg-primary/10 text-primary' : 'rounded-full'
        }
        aria-label={label}
        title={label}
        aria-pressed={recording}
        disabled={
          props.disabled || phase === 'requesting' || phase === 'transcribing'
        }
        onClick={() =>
          recording && active.current
            ? void finish(active.current)
            : void start()
        }
      >
        {recording ? (
          <Square className="size-4 fill-current" />
        ) : phase === 'idle' ? (
          <Mic className="size-4" />
        ) : (
          <Loader2 className="size-4 animate-spin" />
        )}
      </InputGroupButton>
      {phase !== 'idle' && (
        <>
          <output aria-live="polite" className="text-xs text-muted-foreground">
            {recording
              ? `录音 ${seconds}s / 60s`
              : phase === 'requesting'
                ? '开启麦克风…'
                : '正在识别…'}
          </output>
          <InputGroupButton
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="取消语音输入"
            title="取消语音输入"
            onClick={cancel}
          >
            <X className="size-4" />
          </InputGroupButton>
        </>
      )}
    </div>
  );
}
