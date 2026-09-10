import { readFileSync } from 'node:fs';
import { requireValue } from './accounts-store.mjs';

export const mcpPresets = JSON.parse(
  readFileSync(new URL('../data/mcp-presets.json', import.meta.url), 'utf8'),
);
export function withMcpPresets(saved = []) {
  return [
    ...mcpPresets.map((preset) => ({
      ...preset,
      enabled: false,
      tools: [],
      token: '',
      headers: [],
      ...saved.find((s) => s.id === preset.id),
      builtin: true,
      runtime: preset.runtime,
    })),
    ...saved.filter((s) => !mcpPresets.some((p) => p.id === s.id)),
  ];
}
export function mcpUrl(value, allowEmpty = false) {
  requireValue(
    typeof value === 'string' && value.length <= 2000,
    400,
    'MCP 地址无效',
  );
  const normalized = value
    .trim()
    .replace(/^\[[^\]]*\]\((https?:\/\/[^\s]+)\)$/, '$1');
  if (!normalized && allowEmpty) return '';
  let url;
  try {
    url = new URL(normalized);
  } catch {
    requireValue(false, 400, 'MCP 地址需要完整 URL');
  }
  requireValue(
    ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.search,
    400,
    'MCP 地址需使用 HTTP(S)，凭据请填写在密钥或请求头中',
  );
  return normalized.replace(/\/$/, '');
}
export function mcpTransport(value = 'streamable_http') {
  const transport =
    {
      streamableHttp: 'streamable_http',
      http: 'streamable_http',
      'streamable-http': 'streamable_http',
    }[value] || value;
  requireValue(
    ['streamable_http', 'sse', 'stdio'].includes(transport),
    400,
    'MCP 连接类型无效',
  );
  return transport;
}
function secret(value, label) {
  requireValue(
    value === undefined ||
      (typeof value === 'string' &&
        value.length <= 8000 &&
        !/[\r\n]/.test(value)),
    400,
    `${label}无效`,
  );
  return value?.trim() || '';
}
export function normalizeMcpServers(input, previous = []) {
  requireValue(
    Array.isArray(input) && input.length <= 16,
    400,
    '最多配置 16 个 MCP 服务',
  );
  const ids = new Set();
  const servers = input.map((s) => {
    requireValue(
      s &&
        typeof s.id === 'string' &&
        /^[a-z][a-z0-9_]{0,31}$/.test(s.id) &&
        !ids.has(s.id),
      400,
      'MCP 标识需唯一，使用小写字母、数字或下划线',
    );
    ids.add(s.id);
    const preset = mcpPresets.find((p) => p.id === s.id),
      old = previous.find((p) => p.id === s.id);
    const transport = mcpTransport(s.transport || preset?.transport);
    requireValue(
      transport !== 'stdio' || preset?.runtime === 'fliggy',
      400,
      '命令型 MCP 请部署成独立服务后填写地址；当前内置飞猪运行环境',
    );
    requireValue(
      typeof s.name === 'string' && s.name.trim() && s.name.length <= 60,
      400,
      '请填写 MCP 名称',
    );
    requireValue(
      Array.isArray(s.tools) &&
        s.tools.length <= 100 &&
        s.tools.every(
          (t) => typeof t === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(t),
        ),
      400,
      '工具列表无效',
    );
    const url = transport === 'stdio' ? '' : mcpUrl(s.url, Boolean(preset));
    const unchanged =
      old &&
      (old.transport || 'streamable_http') === transport &&
      old.url === url;
    requireValue(
      s.headers === undefined ||
        (Array.isArray(s.headers) && s.headers.length <= 16),
      400,
      '请求头配置无效',
    );
    const headerNames = new Set();
    const headers = (s.headers || (unchanged ? old.headers : []) || []).map(
      (header) => {
        requireValue(
          header && typeof header === 'object',
          400,
          '请求头配置无效',
        );
        const name = header.name;
        requireValue(
          typeof name === 'string' &&
            /^[A-Za-z][A-Za-z0-9-]{0,79}$/.test(name) &&
            !/^(authorization|cookie|host|origin|connection|content-length|content-type|accept|transfer-encoding|proxy-authorization)$/i.test(
              name,
            ) &&
            !headerNames.has(name.toLowerCase()),
          400,
          '请求头名称重复或不允许设置；Authorization 请使用密钥栏',
        );
        headerNames.add(name.toLowerCase());
        return {
          name,
          value:
            secret(header.value, '请求头') ||
            (unchanged &&
              old.headers?.find(
                (h) => h.name.toLowerCase() === name.toLowerCase(),
              )?.value) ||
            '',
        };
      },
    );
    const token = secret(s.token, 'MCP 密钥') || (unchanged && old.token) || '';
    const tools = unchanged || !old ? [...new Set(s.tools)] : [];
    return {
      ...(unchanged ? { discovery: old.discovery } : {}),
      id: s.id,
      name: s.name.trim(),
      transport,
      url,
      token,
      headers,
      tools,
      enabled: s.enabled === true && tools.length > 0,
      ...(preset
        ? {
            builtin: true,
            runtime: preset.runtime,
            proxyApproved: old?.proxyApproved === true,
          }
        : {}),
    };
  });
  return withMcpPresets(servers);
}
export function publicMcpServer({ token, headers = [], ...s }) {
  const preset = mcpPresets.find((p) => p.id === s.id);
  return {
    ...s,
    builtin: Boolean(preset),
    description: preset?.description,
    tokenConfigured: Boolean(token),
    headers: headers.map(({ name, value }) => ({
      name,
      configured: Boolean(value),
    })),
    ready:
      s.transport === 'stdio'
        ? Boolean(token && s.proxyApproved)
        : Boolean(s.url),
  };
}
export function importMcpConfig(input, previous) {
  requireValue(
    input && typeof input === 'object' && !Array.isArray(input),
    400,
    '请粘贴 MCP JSON 配置',
  );
  let entries = input.mcpServers || input;
  if (entries.url || entries.command) entries = { imported: entries };
  requireValue(
    entries && typeof entries === 'object' && !Array.isArray(entries),
    400,
    'mcpServers 格式无效',
  );
  const result = [...previous];
  for (const [name, spec] of Object.entries(entries)) {
    requireValue(spec && typeof spec === 'object', 400, 'MCP 服务配置无效');
    const transport = mcpTransport(
      spec.transport ||
        spec.type ||
        (spec.command
          ? 'stdio'
          : String(spec.url).replace(/\)$/, '').endsWith('/sse')
            ? 'sse'
            : 'streamable_http'),
    );
    let preset;
    if (transport === 'stdio') {
      requireValue(
        spec.command === 'uvx' &&
          JSON.stringify(spec.args) ===
            JSON.stringify(['mcp-fliggy-travel==0.5.1']),
        400,
        '当前仅内置飞猪命令运行环境，其他命令请部署为 MCP 服务后导入地址',
      );
      preset = mcpPresets.find((p) => p.id === 'fliggy');
    }
    const url = transport === 'stdio' ? '' : mcpUrl(spec.url);
    preset ||= mcpPresets.find(
      (p) =>
        (p.url && p.url === url) ||
        (p.id === 'amap' && new URL(url).hostname === p.host),
    );
    const id =
      preset?.id ||
      name
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/^[^a-z]+/, '')
        .slice(0, 32) ||
      'imported';
    const old = result.find((s) => s.id === id);
    for (const field of ['headers', 'env'])
      requireValue(
        spec[field] === undefined ||
          (spec[field] &&
            typeof spec[field] === 'object' &&
            !Array.isArray(spec[field])),
        400,
        'MCP 请求头或环境配置无效',
      );
    const headers = Object.entries(spec.headers || {});
    const authorization = headers.find(
      ([key]) => key.toLowerCase() === 'authorization',
    )?.[1];
    requireValue(
      !authorization ||
        (typeof authorization === 'string' && /^Bearer /i.test(authorization)),
      400,
      'Authorization 需要使用 Bearer Token',
    );
    const env = Object.fromEntries(
      Object.entries(spec.env || {}).map(([key, value]) => [
        key.replaceAll('\\_', '_'),
        value,
      ]),
    );
    const imported = {
      ...old,
      id,
      name: preset?.name || name,
      transport,
      url,
      token:
        transport === 'stdio'
          ? env.FLYAI_API_KEY
          : authorization?.replace(/^Bearer\s+/i, ''),
      headers: headers
        .filter(([key]) => key.toLowerCase() !== 'authorization')
        .map(([name, value]) => ({ name, value })),
      enabled: false,
      tools: [],
    };
    const index = result.findIndex((s) => s.id === id);
    if (index >= 0) result[index] = imported;
    else result.push(imported);
  }
  return normalizeMcpServers(result, previous);
}
