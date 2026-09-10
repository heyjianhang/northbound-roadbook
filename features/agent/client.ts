export type Part =
  | { type: 'text'; text: string }
  | { type: 'notice'; text: string }
  | {
      type: 'tool';
      id: string;
      name: string;
      input: unknown;
      output?: string;
      state: 'input-available' | 'output-available' | 'output-error';
    };
export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  authorId: string;
  authorName: string;
  text: string;
  parts: Part[];
  status: string;
  createdAt: string;
};
export type ChatSnapshot = {
  revision: number;
  messages: ChatMessage[];
  busy: boolean;
  ready: boolean;
  speechReady: boolean;
  memoryMode: 'semantic' | 'keyword';
};
export type Memory = {
  id: string;
  content: string;
  author: string;
  updatedBy: string;
  updatedAt: string;
};
export type McpServer = {
  id: string;
  name: string;
  url: string;
  transport?: 'streamable_http' | 'sse' | 'stdio';
  builtin?: boolean;
  description?: string;
  proxyApproved?: boolean;
  headers?: { name: string; value?: string; configured?: boolean }[];
  discovery?: {
    checkedAt: string;
    error: string;
    tools: {
      name: string;
      sourceName?: string;
      description: string;
      readOnly: boolean;
    }[];
  };
  token?: string;
  tokenConfigured?: boolean;
  enabled: boolean;
  tools: string[];
};
export type AgentConfig = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  keyConfigured: boolean;
  ready: boolean;
  embeddingModel: string;
  envManaged: string[];
  servers: McpServer[];
  speech: {
    apiKey?: string;
    appId: string;
    accessToken?: string;
    keyConfigured: boolean;
    tokenConfigured: boolean;
    ready: boolean;
    envManaged: string[];
  };
};
export async function agentApi<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch('/api/agent/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  const data = (await response.json()) as { error?: string };
  if (response.status === 401)
    window.dispatchEvent(new Event('account-expired'));
  if (!response.ok) throw new Error(data.error || '助手暂时不可用，请重试');
  return data as T;
}
