'use client';
/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- 可滚动区域需要接收键盘焦点，便于使用方向键翻阅工具。 */
import { useState } from 'react';
import { ChevronRight, Loader2, Wrench } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { MessageResponse } from '@/components/ai-elements/message';
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';
import type { ChatMessage, Part } from './client';

type ToolPart = Extract<Part, { type: 'tool' }>;

function ToolCalls({ tools, status }: { tools: ToolPart[]; status: string }) {
  const [open, setOpen] = useState(false);
  const failed = tools.filter((tool) => tool.state === 'output-error').length;
  const running = status === 'running';
  const label = running
    ? '处理中'
    : status === 'stopped'
      ? '已停止'
      : status === 'interrupted'
        ? '已中断'
        : status === 'error'
          ? '处理失败'
          : '已处理';
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="not-prose min-w-0"
    >
      <CollapsibleTrigger className="group/process flex min-h-11 w-full items-center gap-2 rounded-md py-2 text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        {running ? (
          <Loader2
            aria-hidden="true"
            className="size-3.5 shrink-0 animate-spin"
          />
        ) : (
          <Wrench aria-hidden="true" className="size-3.5 shrink-0" />
        )}
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span>处理过程 · {label}</span>
          <span>{tools.length} 项工具</span>
          {failed > 0 && (
            <span className="text-destructive">{failed} 项失败</span>
          )}
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-3.5 shrink-0 transition-transform group-data-panel-open/process:rotate-90"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <section
          className="flex max-h-80 min-w-0 flex-col gap-2 overflow-y-auto overscroll-contain pb-2"
          aria-label="工具调用详情"
          tabIndex={0}
        >
          {tools.map((part) => (
            <Tool key={part.id} defaultOpen={false} className="mb-0">
              <ToolHeader
                type={`tool-${part.name}`}
                title={toolLabel(part.name)}
                state={part.state}
              />
              <ToolContent>
                <ToolInput input={part.input} />
                <ToolOutput
                  output={part.output}
                  errorText={
                    part.state === 'output-error'
                      ? '工具未完成，请重试或检查连接'
                      : undefined
                  }
                />
              </ToolContent>
            </Tool>
          ))}
        </section>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function AssistantParts({ message }: { message: ChatMessage }) {
  const tools = message.parts.filter(
    (part): part is ToolPart => part.type === 'tool',
  );
  const firstTool = message.parts.findIndex((part) => part.type === 'tool');
  return message.parts.map((part, index) => {
    if (part.type === 'tool')
      return index === firstTool ? (
        <ToolCalls key="tools" tools={tools} status={message.status} />
      ) : null;
    if (part.type === 'notice')
      return (
        <output
          key={index}
          className="rounded-lg bg-secondary p-3 text-sm text-muted-foreground"
        >
          {part.text}
        </output>
      );
    return (
      <MessageResponse
        key={index}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: () => null,
        }}
      >
        {part.text}
      </MessageResponse>
    );
  });
}

function toolLabel(name: string) {
  return (
    (
      {
        read_roadbook: '读取路书',
        notes_list_place_notes: '查找地点笔记',
        notes_read_place_note: '读取地点笔记',
        notes_write_place_note: '保存地点笔记',
        notes_edit_place_note: '编辑地点笔记',
        manage_memory: '整理记忆',
        search_trip_memory: '查找旅行记忆',
        write_todos: '安排任务',
      } as Record<string, string>
    )[name] || name
  );
}
