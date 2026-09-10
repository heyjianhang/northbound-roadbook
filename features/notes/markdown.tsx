'use client';
import { MessageResponse } from '@/components/ai-elements/message';

export function safeMarkdownUrl(value: string) {
  try {
    const parsed = new URL(value, 'https://roadbook.local');
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol)
      ? value
      : '';
  } catch {
    return '';
  }
}
const components = {
  a: ({ href, children }: React.ComponentProps<'a'>) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};
export function NoteMarkdown({ content }: { content: string }) {
  return (
    <MessageResponse
      className="note-markdown"
      mode="static"
      parseIncompleteMarkdown={false}
      skipHtml
      rehypePlugins={[]}
      urlTransform={safeMarkdownUrl}
      components={components}
    >
      {content}
    </MessageResponse>
  );
}
