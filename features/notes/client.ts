export type PlaceNote = {
  placeId: string;
  name: string;
  days: string[];
  content: string;
  version: number;
  updatedBy: string;
  updatedName: string;
  updatedAt: string;
};
export class NoteRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public current?: PlaceNote,
  ) {
    super(message);
  }
}
export async function noteApi(
  placeId: string,
  input?: { content: string; expectedVersion: number },
  signal?: AbortSignal,
): Promise<PlaceNote> {
  const response = await fetch(
    '/api/agent/notes' + (input ? '' : '?' + new URLSearchParams({ placeId })),
    {
      method: input ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
      ...(input
        ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ placeId, ...input }),
          }
        : {}),
    },
  );
  const data = (await response.json()) as {
    ok: boolean;
    error?: string;
    note: PlaceNote;
  };
  if (response.status === 401)
    window.dispatchEvent(new Event('account-expired'));
  if (!response.ok || !data.ok)
    throw new NoteRequestError(
      data.error || '笔记暂时不可用，请重试',
      response.status,
      data.note,
    );
  return data.note;
}
