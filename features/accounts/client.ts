export type AccountUser = {
  id: string;
  username: string;
  name: string;
  avatar: string;
  role: 'admin' | 'member';
  disabled: boolean;
  createdAt: number;
};
export type Session = { adminConfigured: boolean; user: AccountUser | null };
export type AccountLink = { kind: 'invite' | 'reset'; token: string };
export async function accountApi<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/accounts/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    if (response.status === 401 && path !== 'login')
      window.dispatchEvent(new Event('account-expired'));
    throw new Error(result.error || '请求失败，请稍后重试');
  }
  return result as T;
}
export function accountLink(kind: 'invite' | 'reset', token: string) {
  return `${window.location.origin}/#account=${kind}&token=${encodeURIComponent(token)}`;
}
export async function prepareAvatar(file: File): Promise<string> {
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  )
    throw new Error('请选择 5 MB 以内的 JPEG、PNG 或 WebP 图片');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 160;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法处理头像，请换一张图片');
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      160,
      160,
    );
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    bitmap.close();
  }
}
