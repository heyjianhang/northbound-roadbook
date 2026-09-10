// Adapted from Vercel AI Elements (Apache-2.0): https://github.com/vercel/ai-elements
// Text-only composition uses the existing Base UI input group. Attachments are not enabled.+'use client';
import type { ChatStatus } from 'ai';
import { ArrowUpIcon, Loader2Icon, SquareIcon } from 'lucide-react';
import {
  useState,
  type ComponentProps,
  type FormEvent,
  type HTMLAttributes,
} from 'react';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group';
import { cn } from '@/lib/utils';

export type PromptInputMessage = { text: string };
export type PromptInputProps = Omit<
  HTMLAttributes<HTMLFormElement>,
  'onSubmit'
> & {
  onSubmit: (
    message: PromptInputMessage,
    event: FormEvent<HTMLFormElement>,
  ) => void | Promise<void>;
};
export const PromptInput = ({
  className,
  onSubmit,
  children,
  ...props
}: PromptInputProps) => (
  <form
    className={cn('w-full', className)}
    {...props}
    onSubmit={(event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const text = String(new FormData(form).get('message') || '');
      if (!text.trim()) return;
      Promise.resolve(onSubmit({ text }, event)).catch(() => {
        /* The caller displays the error and preserves the draft. */
      });
    }}
  >
    <InputGroup className="overflow-hidden">{children}</InputGroup>
  </form>
);
export const PromptInputBody = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('contents', className)} {...props} />
);
export const PromptInputTextarea = ({
  className,
  placeholder = '聊聊这趟旅行…',
  ...props
}: ComponentProps<typeof InputGroupTextarea>) => {
  const [composing, setComposing] = useState(false);
  return (
    <InputGroupTextarea
      name="message"
      placeholder={placeholder}
      className={cn('field-sizing-content max-h-40 min-h-16', className)}
      onCompositionStart={() => setComposing(true)}
      onCompositionEnd={() => setComposing(false)}
      onKeyDown={(e) => {
        if (
          e.key !== 'Enter' ||
          e.shiftKey ||
          composing ||
          e.nativeEvent.isComposing ||
          e.keyCode === 229
        )
          return;
        e.preventDefault();
        const button = e.currentTarget.form?.querySelector<HTMLButtonElement>(
          'button[type="submit"]',
        );
        if (button && !button.disabled) e.currentTarget.form?.requestSubmit();
      }}
      {...props}
    />
  );
};
export const PromptInputFooter = ({
  className,
  ...props
}: Omit<ComponentProps<typeof InputGroupAddon>, 'align'>) => (
  <InputGroupAddon
    align="block-end"
    className={cn('justify-between gap-1', className)}
    {...props}
  />
);
export const PromptInputSubmit = ({
  status,
  children,
  className,
  ...props
}: ComponentProps<typeof InputGroupButton> & { status?: ChatStatus }) => (
  <InputGroupButton
    aria-label={status === 'streaming' ? '停止回复' : '发送消息'}
    size="icon-sm"
    type="submit"
    variant="default"
    className={cn('rounded-full', className)}
    {...props}
  >
    {children ??
      (status === 'submitted' ? (
        <Loader2Icon className="size-4 animate-spin" />
      ) : status === 'streaming' ? (
        <SquareIcon className="size-4" />
      ) : (
        <ArrowUpIcon className="size-4" />
      ))}
  </InputGroupButton>
);
