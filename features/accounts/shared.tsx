'use client';
import { useId, useRef, useState } from 'react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { prepareAvatar } from './client';
export function Notice({
  message,
  error = false,
}: {
  message: string;
  error?: boolean;
}) {
  if (!message) return null;
  return (
    <Alert
      variant={error ? 'destructive' : 'default'}
      role={error ? 'alert' : 'status'}
    >
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
export function MemberAvatar({
  name,
  avatar,
}: {
  name: string;
  avatar: string;
}) {
  return (
    <Avatar className="size-12">
      <AvatarImage src={avatar || undefined} alt={name} />
      <AvatarFallback>{name.trim().slice(0, 2) || '旅伴'}</AvatarFallback>
    </Avatar>
  );
}
export function AvatarField({
  name,
  value,
  onChange,
  onBusy,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Field>
      <FieldLabel htmlFor={`${id}-trigger`}>头像（选填）</FieldLabel>
      <div className="flex items-center gap-3">
        <Button
          id={`${id}-trigger`}
          type="button"
          variant="ghost"
          className="h-auto gap-3 p-0"
          disabled={busy}
          aria-busy={busy}
          aria-describedby={`${id}-hint`}
          onClick={() => inputRef.current?.click()}
        >
          <MemberAvatar name={name} avatar={value} />
          {busy && <Spinner data-icon="inline-start" />}
          <span>{busy ? '正在处理…' : value ? '更换头像' : '上传头像'}</span>
        </Button>
        {value && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onChange('')}
          >
            移除头像
          </Button>
        )}
      </div>
      <Input
        ref={inputRef}
        id={id}
        type="file"
        hidden
        aria-label="选择头像文件"
        accept="image/jpeg,image/png,image/webp"
        disabled={busy}
        aria-describedby={`${id}-hint`}
        onChange={async (event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (!file) return;
          setBusy(true);
          onBusy?.(true);
          setError('');
          try {
            onChange(await prepareAvatar(file));
          } catch (e) {
            setError(e instanceof Error ? e.message : '头像处理失败');
          } finally {
            setBusy(false);
            onBusy?.(false);
          }
        }}
      />
      <FieldDescription id={`${id}-hint`}>
        支持 JPEG、PNG、WebP，最多 5 MB。
      </FieldDescription>
      <Notice message={error} error />
    </Field>
  );
}
export function SubmitButton({
  busy,
  children,
}: {
  busy: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button type="submit" size="lg" disabled={busy} aria-busy={busy}>
      {busy && <Spinner data-icon="inline-start" />}
      {children}
    </Button>
  );
}
