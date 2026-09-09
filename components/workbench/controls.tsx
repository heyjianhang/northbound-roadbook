'use client';
import { useId, type ComponentProps } from 'react';
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectValue,
  SelectItem,
  SelectGroup,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info, ExternalLink } from 'lucide-react';
import { safeUrl } from '@/lib/planner';
export function TextField({
  label,
  hint,
  ...props
}: ComponentProps<typeof Input> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} {...props} />
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </Field>
  );
}
export function NoteField({
  label,
  ...props
}: ComponentProps<typeof Textarea> & { label: string }) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea id={id} {...props} />
    </Field>
  );
}
export function Choice({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        value={value}
        onValueChange={(v) => {
          if (v !== null) onChange(String(v));
        }}
        items={options}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <Alert variant={error ? 'destructive' : 'default'} className="notice">
      <Info />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
export function External({
  url,
  children,
}: {
  url: string;
  children: React.ReactNode;
}) {
  return safeUrl(url) ? (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="external-link"
    >
      {children}
      <ExternalLink size={13} />
    </a>
  ) : null;
}
export const numberValue = (value: string) =>
  value.trim() === '' ? null : Number(value);
