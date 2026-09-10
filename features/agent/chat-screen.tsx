'use client';
import { useEffect, useRef, useState } from 'react';
import { Brain, Compass, Copy, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageContent,
  MessageActions,
  MessageAction,
} from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from '@/components/ai-elements/prompt-input';
import { AssistantParts } from './message-parts';
import { Notice } from '@/features/accounts/shared';
import { useAccount } from '@/features/accounts/context';
import { accountApi } from '@/features/accounts/client';
import { Memories } from './memories';
import { SpeechInput } from './speech-input';
import { agentApi, type ChatSnapshot } from './client';

const suggestions = [
  '帮我们梳理一下今天的行程',
  '查查路书里有哪些适合看日落的地方',
  '请记住：我们喜欢轻松一点的旅行节奏',
];
function Channel({ dayId }: { dayId: string }) {
  const { session } = useAccount();
  const [companions, setCompanions] = useState<
    Record<string, { name: string; avatar: string }>
  >({});
  const [snapshot, setSnapshot] = useState<ChatSnapshot | null>(null),
    [draft, setDraft] = useState(''),
    [error, setError] = useState(''),
    [sending, setSending] = useState(false),
    [voiceActive, setVoiceActive] = useState(false),
    [connected, setConnected] = useState(false),
    [copied, setCopied] = useState('');
  const request = useRef({ text: '', id: '' }),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const events = new EventSource('/api/agent/events');
    events.addEventListener('memory', () =>
      window.dispatchEvent(new Event('agent-memory-changed')),
    );
    events.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ChatSnapshot;
        setSnapshot((current) =>
          !current || data.revision >= current.revision ? data : current,
        );
        setConnected(true);
      } catch {
        setError('消息同步失败，请刷新页面');
      }
    };
    events.onerror = () => setConnected(false);
    void accountApi<{
      companions: { id: string; name: string; avatar: string }[];
    }>('companions')
      .then((data) => {
        if (!controller.signal.aborted)
          setCompanions(
            Object.fromEntries(
              data.companions.map((person) => [person.id, person]),
            ),
          );
      })
      .catch(() => {});
    // EventSource reconnects with a fresh snapshot. Fetch also reports login/configuration errors clearly.
    agentApi<ChatSnapshot>('chat', undefined, controller.signal)
      .then((data) => setSnapshot((current) => current || data))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => {
      mounted.current = false;
      events.close();
      controller.abort();
    };
  }, []);
  const busy = sending || snapshot?.busy;
  const running = snapshot?.messages.findLast((m) => m.status === 'running');
  const canStop = running?.authorId === session.user!.id;
  async function send(text: string) {
    if (busy || voiceActive || !snapshot?.ready || !text.trim()) return;
    if (text.length > 12000) {
      setError('消息最多 12000 个字符，请缩短后发送');
      return;
    }
    setError('');
    setSending(true);
    if (request.current.text !== text)
      request.current = { text, id: crypto.randomUUID() };
    try {
      const data = await agentApi<ChatSnapshot>('chat', {
        text,
        dayId,
        requestId: request.current.id,
      });
      if (mounted.current) {
        setSnapshot((current) =>
          !current || data.revision >= current.revision ? data : current,
        );
        setDraft((current) => (current === text ? '' : current));
        request.current = { text: '', id: '' };
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
      throw e;
    } finally {
      if (mounted.current) setSending(false);
    }
  }
  return (
    <div className="agent-channel">
      <Conversation className="min-h-0" aria-label="共同聊天记录">
        <ConversationContent className="mx-auto w-full max-w-3xl gap-6 p-4 sm:p-6">
          {!snapshot ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              正在读取对话…
            </p>
          ) : snapshot.messages.length === 0 ? (
            <ConversationEmptyState className="min-h-64 px-2 py-10">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Compass className="size-7" />
              </span>
              <h2 className="mt-2 text-xl font-semibold">
                一起商量，下一站去哪。
              </h2>
              <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
                旅伴们在这里和助手一起聊行程、查地点，记下共同的决定。
              </p>
              <div className="mt-4 flex w-full max-w-md flex-col gap-2">
                {suggestions.map((text) => (
                  <Button
                    key={text}
                    className="h-auto min-h-10 whitespace-normal px-4 py-3 text-left"
                    variant="outline"
                    disabled={!snapshot.ready}
                    onClick={() => setDraft(text)}
                  >
                    {text}
                  </Button>
                ))}
              </div>
            </ConversationEmptyState>
          ) : (
            snapshot.messages.map((message) => (
              <Message
                key={message.id}
                from={message.role}
                className="max-w-full"
              >
                <div
                  className={`flex items-center gap-2 text-xs text-muted-foreground ${message.role === 'user' ? 'justify-end' : ''}`}
                >
                  <Avatar className="size-6">
                    {message.role === 'user' && (
                      <AvatarImage
                        src={
                          (message.authorId === session.user!.id
                            ? session.user!.avatar
                            : companions[message.authorId]?.avatar) || undefined
                        }
                        alt=""
                      />
                    )}
                    <AvatarFallback className="bg-secondary text-[10px]">
                      {message.role === 'assistant' ? (
                        <Compass className="size-3.5 text-primary" />
                      ) : (
                        message.authorName.slice(0, 2)
                      )}
                    </AvatarFallback>
                  </Avatar>
                  <span>
                    {message.role === 'assistant'
                      ? message.authorName
                      : message.authorId === session.user!.id
                        ? session.user!.name
                        : companions[message.authorId]?.name ||
                          message.authorName}
                  </span>
                </div>
                <MessageContent
                  data-author={
                    message.role === 'user'
                      ? message.authorId === session.user!.id
                        ? 'self'
                        : 'companion'
                      : undefined
                  }
                  className={message.role === 'assistant' ? 'w-full' : ''}
                >
                  {message.role === 'user' ? (
                    <p className="whitespace-pre-wrap break-words">
                      {message.text}
                    </p>
                  ) : (
                    <AssistantParts message={message} />
                  )}
                  {message.status === 'running' &&
                    !message.parts.some((part) => part.type === 'tool') && (
                      <span className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" />
                        助手正在处理…
                      </span>
                    )}
                  {message.status === 'interrupted' && (
                    <p className="text-sm text-muted-foreground">
                      服务重启中断了这次回复，可以重新发送问题。
                    </p>
                  )}
                </MessageContent>
                {message.role === 'assistant' &&
                  message.status === 'complete' &&
                  message.text && (
                    <MessageActions>
                      <MessageAction
                        label="复制回复"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(message.text);
                            setCopied(message.id);
                          } catch {
                            setError('复制失败，请手动选择文本');
                          }
                        }}
                      >
                        {copied === message.id ? (
                          <Check className="size-3.5" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                      </MessageAction>
                    </MessageActions>
                  )}
              </Message>
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton aria-label="回到最新消息" />
      </Conversation>
      <footer className="agent-composer">
        <div className="mx-auto w-full max-w-3xl space-y-2">
          <Notice error message={error} />
          {!connected && snapshot && (
            <output className="block text-xs text-muted-foreground">
              正在重新连接对话…
            </output>
          )}
          {snapshot && !snapshot.ready && (
            <Notice message="助手还没有接通模型，请管理员在管理页面填写模型地址、模型名和密钥。" />
          )}
          <PromptInput onSubmit={({ text }) => send(text)}>
            <PromptInputBody>
              <PromptInputTextarea
                aria-label="发送给北行助手的消息"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={12000}
                disabled={!snapshot?.ready || sending}
                placeholder="和旅伴一起问问助手…"
              />
            </PromptInputBody>
            <PromptInputFooter className="justify-end gap-2">
              <SpeechInput
                ready={Boolean(snapshot?.speechReady)}
                disabled={sending}
                onActiveChange={setVoiceActive}
                onError={setError}
                onText={(text) =>
                  setDraft((current) =>
                    current
                      ? `${current}${/\s$/.test(current) ? '' : '\n'}${text}`
                      : text,
                  )
                }
              />
              {snapshot?.busy && canStop ? (
                <PromptInputSubmit
                  status="streaming"
                  type="button"
                  onClick={async () => {
                    try {
                      await agentApi('stop', {});
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                />
              ) : (
                <PromptInputSubmit
                  status={busy ? 'submitted' : 'ready'}
                  disabled={
                    !snapshot?.ready ||
                    !draft.trim() ||
                    Boolean(busy) ||
                    voiceActive
                  }
                />
              )}
            </PromptInputFooter>
          </PromptInput>
        </div>
      </footer>
    </div>
  );
}
export function ChatScreen({ dayId }: { dayId: string }) {
  const [memoryOpen, setMemoryOpen] = useState(false);
  return (
    <section className="agent-page" aria-label="北行助手">
      <header className="agent-heading">
        <div>
          <h1>北行助手</h1>
        </div>
        <Button
          variant="outline"
          onClick={() => setMemoryOpen((v) => !v)}
          aria-expanded={memoryOpen}
        >
          <Brain />
          记忆
        </Button>
      </header>
      <div className="agent-workspace">
        <Channel dayId={dayId} />
        {memoryOpen && <Memories onClose={() => setMemoryOpen(false)} />}
      </div>
    </section>
  );
}
