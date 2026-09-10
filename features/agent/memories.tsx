'use client';
import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Notice } from '@/features/accounts/shared';
import { agentApi, type Memory } from './client';

function MemoryItem({
  memory,
  onSaved,
}: {
  memory: Memory;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false),
    [text, setText] = useState(memory.content),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function save(remove = false) {
    setBusy(true);
    setError('');
    try {
      await agentApi('memories', {
        memoryId: memory.id,
        content: text,
        delete: remove,
      });
      await onSaved();
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="rounded-xl border bg-background p-3">
      {editing ? (
        <Textarea
          aria-label="记忆内容"
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
        />
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm">
          {memory.content}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <small className="text-muted-foreground">
          {memory.author} 记录 · {memory.updatedBy} 更新
          <br />
          {new Date(memory.updatedAt).toLocaleString('zh-CN', {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </small>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (editing) void save();
              else {
                setText(memory.content);
                setEditing(true);
              }
            }}
          >
            {editing ? '保存' : '编辑'}
          </Button>
          {editing ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              取消
            </Button>
          ) : (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="删除这条记忆"
              disabled={busy}
              onClick={() => void save(true)}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      </div>
      <Notice error message={error} />
    </article>
  );
}
export function Memories({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Memory[]>([]),
    [text, setText] = useState(''),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const version = useRef(0);
  async function refresh() {
    const request = ++version.current;
    const data = await agentApi<{ memories: Memory[] }>('memories');
    if (request === version.current) setItems(data.memories);
  }
  useEffect(() => {
    const controller = new AbortController();
    const load = () => {
      const request = ++version.current;
      agentApi<{ memories: Memory[] }>('memories', undefined, controller.signal)
        .then((d) => {
          if (!controller.signal.aborted && request === version.current)
            setItems(d.memories);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    };
    load();
    window.addEventListener('agent-memory-changed', load);
    return () => {
      controller.abort();
      window.removeEventListener('agent-memory-changed', load);
    };
  }, []);
  return (
    <section className="agent-memory-panel" aria-label="共同记忆">
      <header className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">共同记忆</h2>
        <Button
          size="icon"
          variant="ghost"
          aria-label="关闭记忆"
          onClick={onClose}
        >
          <X />
        </Button>
      </header>
      <p className="text-xs text-muted-foreground">
        旅伴们一起维护，所有人都可以添加、编辑和删除。
      </p>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            正在读取记忆…
          </p>
        ) : items.length ? (
          items.map((m) => (
            <MemoryItem key={m.id} memory={m} onSaved={refresh} />
          ))
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            还没有记忆。可以在聊天时说“请记住…”。
          </p>
        )}
      </div>
      <Notice error message={error} />
      <form
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await agentApi('memories', { content: text });
            setText('');
            await refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          aria-label="新增记忆内容"
          placeholder="例如：每天上午九点以后出发"
        />
        <Button
          className="w-full"
          type="submit"
          disabled={busy || !text.trim()}
        >
          <Plus />
          添加共同记忆
        </Button>
      </form>
    </section>
  );
}
