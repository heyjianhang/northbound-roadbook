'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FilePenLine, Copy, RotateCcw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from '@/components/ui/field';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Notice } from '@/features/accounts/shared';
import { noteApi, NoteRequestError, type PlaceNote as Note } from './client';
import { NoteMarkdown } from './markdown';

export function PlaceNote({
  stopId,
  active,
}: {
  stopId: string;
  active: boolean;
}) {
  const [baseContent, setBaseContent] = useState('');
  const [note, setNote] = useState<Note | null>(null),
    [draft, setDraft] = useState(''),
    [editing, setEditing] = useState(false),
    [preview, setPreview] = useState('edit');
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [conflict, setConflict] = useState<Note | null>(null),
    [reload, setReload] = useState(0);
  const current = useRef<Note | null>(null),
    base = useRef<Note | null>(null),
    editingRef = useRef(false),
    draftRef = useRef(''),
    busyRef = useRef(false),
    alive = useRef(true);
  const setBase = useCallback((value: Note) => {
    base.current = value;
    setBaseContent(value.content);
  }, []);
  const changeDraft = useCallback((value: string) => {
    draftRef.current = value;
    setDraft(value);
    setNotice('');
  }, []);
  const accept = useCallback(
    (value: Note) => {
      if (current.current && current.current.version > value.version) return;
      current.current = value;
      setNote(value);
      if (!editingRef.current || draftRef.current === base.current?.content) {
        setBase(value);
        changeDraft(value.content);
        setConflict(null);
      } else if (base.current?.version !== value.version) setConflict(value);
    },
    [changeDraft, setBase],
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    let ended = false,
      inFlight = false;
    const controller = new AbortController();
    async function load() {
      if (
        ended ||
        inFlight ||
        busyRef.current ||
        document.visibilityState === 'hidden'
      )
        return;
      inFlight = true;
      try {
        const result = await noteApi(stopId, undefined, controller.signal);
        if (!ended && !busyRef.current) {
          accept(result);
          setError('');
        }
      } catch (e) {
        if (!ended && !controller.signal.aborted && !busyRef.current)
          setError((e as Error).message);
      } finally {
        inFlight = false;
      }
    }
    void load();
    const timer = setInterval(load, 5000);
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', load);
    return () => {
      ended = true;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', load);
    };
    // Mutable refs let refreshes preserve unsaved edits without restarting the poll.
  }, [stopId, active, reload, accept]);
  useEffect(() => {
    if (!editing || draft === baseContent) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [editing, draft, baseContent]);
  const startEdit = () => {
    if (!current.current) return;
    setBase(current.current);
    changeDraft(current.current.content);
    editingRef.current = true;
    setEditing(true);
    setPreview('edit');
    setConflict(null);
    setNotice('');
  };
  async function save() {
    if (!base.current || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await noteApi(stopId, {
        content: draftRef.current,
        expectedVersion: base.current.version,
      });
      if (!alive.current) return;
      editingRef.current = false;
      setEditing(false);
      accept(saved);
      setNotice('笔记已保存');
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof NoteRequestError && e.status === 409 && e.current) {
        current.current = e.current;
        setNote(e.current);
        setConflict(e.current);
      } else setError((e as Error).message);
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section
      className="place-note flex min-w-0 flex-col gap-4"
      aria-label="地点共同笔记"
      aria-busy={busy}
    >
      <Notice message={error} error />
      {error && (
        <Button
          variant="outline"
          className="self-start"
          disabled={busy}
          onClick={() => setReload((v) => v + 1)}
        >
          <RotateCcw data-icon="inline-start" />
          重新加载
        </Button>
      )}
      <Notice message={notice} />
      {!note && !error && (
        <output className="flex flex-col gap-3" aria-label="正在加载笔记">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-28 w-full" />
        </output>
      )}
      {note && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {note.updatedName
                ? `${note.updatedName} · ${new Date(note.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 更新`
                : '共同笔记'}
            </p>
            {!editing && note.content && (
              <Button variant="outline" onClick={startEdit}>
                <FilePenLine data-icon="inline-start" />
                编辑
              </Button>
            )}
            {editing && (
              <span className="text-xs text-muted-foreground">
                {draft !== baseContent ? '未保存' : '编辑中'}
              </span>
            )}
          </div>
          {editing ? (
            <>
              {conflict && (
                <div className="flex flex-col gap-3">
                  <Notice
                    error
                    message="笔记已有新版本。你的草稿已保留，请对照最新内容合并修改。"
                  />
                  <details>
                    <summary className="cursor-pointer text-sm">
                      查看最新内容
                    </summary>
                    <div className="mt-3">
                      <NoteMarkdown content={conflict.content || '暂无内容'} />
                    </div>
                  </details>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(draftRef.current);
                          setNotice('草稿已复制，可载入最新笔记后粘贴合并');
                        } catch {
                          setError('复制失败，请在编辑框内手动复制草稿');
                        }
                      }}
                    >
                      <Copy data-icon="inline-start" />
                      复制草稿
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setBase(conflict);
                        changeDraft(conflict.content);
                        setConflict(null);
                        setPreview('edit');
                        setError('');
                      }}
                    >
                      放弃草稿，载入最新
                    </Button>
                  </div>
                </div>
              )}
              <Tabs
                value={preview}
                onValueChange={(value) => setPreview(String(value))}
              >
                <TabsList aria-label="笔记编辑模式">
                  <TabsTrigger value="edit">编辑</TabsTrigger>
                  <TabsTrigger value="preview">预览</TabsTrigger>
                </TabsList>
                <TabsContent value="edit" keepMounted>
                  <FieldGroup>
                    <Field>
                      <FieldLabel
                        htmlFor={`note-${stopId}`}
                        className="sr-only"
                      >
                        {note.name}笔记
                      </FieldLabel>
                      <Textarea
                        id={`note-${stopId}`}
                        className="note-editor"
                        value={draft}
                        disabled={busy}
                        maxLength={20000}
                        aria-describedby={`note-hint-${stopId}`}
                        onChange={(e) => changeDraft(e.target.value)}
                        placeholder={
                          '# 旅行笔记\n\n记录想去的地方、想吃的美食…'
                        }
                      />
                      <FieldDescription id={`note-hint-${stopId}`}>
                        支持 Markdown · {draft.length} / 20000
                      </FieldDescription>
                    </Field>
                  </FieldGroup>
                </TabsContent>
                <TabsContent value="preview" keepMounted>
                  <NoteMarkdown content={draft || '暂无内容'} />
                </TabsContent>
              </Tabs>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    editingRef.current = false;
                    setEditing(false);
                    setConflict(null);
                    setError('');
                    if (current.current) accept(current.current);
                  }}
                >
                  取消
                </Button>
                <Button
                  disabled={busy || Boolean(conflict)}
                  onClick={() => void save()}
                >
                  {busy ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <Save data-icon="inline-start" />
                  )}
                  {busy ? '正在保存…' : '保存笔记'}
                </Button>
              </div>
            </>
          ) : note.content ? (
            <NoteMarkdown content={note.content} />
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FilePenLine />
                </EmptyMedia>
                <EmptyTitle>还没有笔记</EmptyTitle>
                <EmptyDescription>
                  记录这里的攻略、美食和旅途想法。
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={startEdit}>
                  <FilePenLine data-icon="inline-start" />
                  写笔记
                </Button>
              </EmptyContent>
            </Empty>
          )}
        </>
      )}
    </section>
  );
}
