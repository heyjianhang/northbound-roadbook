'use client';
import { useState } from 'react';
import { Plus, Trash2, PlugZap, FileJson } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Notice } from '@/features/accounts/shared';
import { agentApi, type AgentConfig, type McpServer } from './client';

type Props = {
  servers: McpServer[];
  busy: boolean;
  setBusy: (value: boolean) => void;
  change: (servers: McpServer[]) => void;
  save: () => Promise<AgentConfig>;
};
export function McpSettings({ servers, busy, setBusy, change, save }: Props) {
  const [open, setOpen] = useState(false),
    [json, setJson] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [importError, setImportError] = useState('');
  const update = (index: number, values: Partial<McpServer>) =>
    change(servers.map((s, i) => (i === index ? { ...s, ...values } : s)));
  const target = (index: number, values: Partial<McpServer>) =>
    update(index, {
      ...values,
      enabled: false,
      tools: [],
      discovery: undefined,
      token: '',
      tokenConfigured: false,
      headers: [],
    });
  async function test(server: McpServer) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await save();
      const result = await agentApi<{ config: AgentConfig }>('admin/mcp-test', {
        id: server.id,
      });
      change(result.config.servers);
      setNotice(`${server.name}连接成功，选择查询工具并启用后保存。`);
    } catch (e) {
      setError((e as Error).message);
      try {
        change((await agentApi<AgentConfig>('admin/config')).servers);
      } catch {
        /* Keep the connection error. */
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 border-t pt-5" aria-label="MCP 服务配置">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-medium">MCP 服务</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            内置旅行服务，也可以导入 MCP JSON。连接后选择助手可用的查询工具。
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setOpen(true);
              setImportError('');
            }}
          >
            <FileJson />
            导入
          </Button>
          <Button
            variant="outline"
            disabled={busy || servers.length >= 16}
            onClick={() =>
              change([
                ...servers,
                {
                  id: 'mcp_' + crypto.randomUUID().slice(0, 8),
                  name: '',
                  transport: 'streamable_http',
                  url: '',
                  enabled: false,
                  tools: [],
                  headers: [],
                },
              ])
            }
          >
            <Plus />
            添加
          </Button>
        </div>
      </div>
      <Notice error message={error} />
      <Notice message={notice} />
      {servers.map((server, index) => (
        <div
          key={server.id}
          className="min-w-0 space-y-3 rounded-xl border p-4"
        >
          <div className="flex items-center justify-between gap-3">
            {server.builtin ? (
              <h4 className="font-medium">
                {server.name}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  内置
                </span>
              </h4>
            ) : (
              <Input
                aria-label="MCP 服务名称"
                placeholder="服务名称"
                value={server.name}
                disabled={busy}
                onChange={(e) => update(index, { name: e.target.value })}
              />
            )}
            {!server.builtin && (
              <Button
                size="icon"
                variant="ghost"
                aria-label={`移除${server.name || 'MCP 服务'}`}
                disabled={busy}
                onClick={() => change(servers.filter((_, i) => i !== index))}
              >
                <Trash2 />
              </Button>
            )}
            {server.builtin && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {server.discovery?.error
                  ? '连接失败'
                  : server.discovery?.tools?.length
                    ? server.enabled
                      ? '已启用'
                      : '已连接'
                    : '待配置'}
              </span>
            )}
          </div>
          {server.description && (
            <p className="text-xs text-muted-foreground">
              {server.description}
            </p>
          )}
          {server.transport === 'stdio' ? (
            <p className="rounded-lg bg-secondary/50 p-3 text-xs text-muted-foreground">
              {server.proxyApproved
                ? '独立运行环境 · mcp-fliggy-travel 0.5.1'
                : '接入方式待确认：此版本通过包作者的第三方代理访问飞猪。'}
            </p>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <NativeSelect
                aria-label={`${server.name}连接类型`}
                value={server.transport || 'streamable_http'}
                disabled={busy}
                onChange={(e) =>
                  target(index, {
                    transport: e.target.value as McpServer['transport'],
                  })
                }
              >
                <NativeSelectOption value="streamable_http">
                  Streamable HTTP
                </NativeSelectOption>
                <NativeSelectOption value="sse">SSE</NativeSelectOption>
              </NativeSelect>
              <Input
                className="min-w-0 flex-1"
                aria-label={`${server.name} MCP 地址`}
                placeholder="https://example.com/mcp"
                value={server.url}
                disabled={busy}
                onChange={(e) => target(index, { url: e.target.value })}
              />
            </div>
          )}
          <Input
            aria-label={`${server.name} MCP 密钥`}
            type="password"
            autoComplete="new-password"
            value={server.token || ''}
            disabled={busy}
            placeholder={
              server.tokenConfigured
                ? '密钥已保存，留空保留'
                : server.transport === 'stdio'
                  ? 'FLYAI_API_KEY'
                  : 'Bearer Token（选填）'
            }
            onChange={(e) => update(index, { token: e.target.value })}
          />
          {server.transport !== 'stdio' && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                自定义请求头
                {server.headers?.length
                  ? ` · ${server.headers.length}`
                  : '（选填）'}
              </summary>
              <div className="mt-3 space-y-2">
                {(server.headers || []).map((header, h) => (
                  <div key={h} className="flex flex-wrap gap-2">
                    <Input
                      className="min-w-0 flex-1"
                      aria-label={`${server.name}请求头 ${h + 1} 名称`}
                      placeholder="X-Api-Key"
                      value={header.name}
                      disabled={busy}
                      onChange={(e) =>
                        update(index, {
                          headers: server.headers!.map((v, i) =>
                            i === h ? { name: e.target.value, value: '' } : v,
                          ),
                        })
                      }
                    />
                    <Input
                      className="min-w-0 flex-1"
                      aria-label={`${server.name}请求头 ${h + 1} 值`}
                      type="password"
                      autoComplete="new-password"
                      placeholder={
                        header.configured ? '已保存，留空保留' : '请求头值'
                      }
                      value={header.value || ''}
                      disabled={busy}
                      onChange={(e) =>
                        update(index, {
                          headers: server.headers!.map((v, i) =>
                            i === h ? { ...v, value: e.target.value } : v,
                          ),
                        })
                      }
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`删除${server.name}请求头 ${h + 1}`}
                      disabled={busy}
                      onClick={() =>
                        update(index, {
                          headers: server.headers!.filter((_, i) => i !== h),
                        })
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || (server.headers?.length || 0) >= 16}
                  onClick={() =>
                    update(index, {
                      headers: [
                        ...(server.headers || []),
                        { name: '', value: '' },
                      ],
                    })
                  }
                >
                  <Plus />
                  添加请求头
                </Button>
              </div>
            </details>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={server.enabled}
                disabled={
                  busy ||
                  !server.tools.length ||
                  (server.transport === 'stdio' && !server.proxyApproved)
                }
                onCheckedChange={(checked) =>
                  update(index, { enabled: checked === true })
                }
              />
              启用 · {server.tools.length} 个工具
            </label>
            <Button
              variant="outline"
              disabled={
                busy ||
                !server.name ||
                (server.transport === 'stdio'
                  ? !server.proxyApproved
                  : !server.url)
              }
              onClick={() => void test(server)}
            >
              <PlugZap />
              测试连接
            </Button>
          </div>
          {server.discovery?.error && (
            <p className="text-xs text-destructive">{server.discovery.error}</p>
          )}
          {!!server.discovery?.tools.length && (
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground">
                可用工具 · {server.discovery.tools.length}
              </summary>
              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                {server.discovery.tools.map((tool) => (
                  <label
                    key={tool.name}
                    className="flex items-start gap-2 rounded-lg bg-secondary/50 p-2 text-sm"
                  >
                    <Checkbox
                      checked={server.tools.includes(tool.name)}
                      disabled={busy || !tool.readOnly}
                      onCheckedChange={(checked) =>
                        update(index, {
                          tools: checked
                            ? [...new Set([...server.tools, tool.name])]
                            : server.tools.filter((name) => name !== tool.name),
                        })
                      }
                    />
                    <span className="min-w-0 break-words">
                      {tool.sourceName || tool.name}
                      <small className="block text-muted-foreground">
                        {tool.readOnly
                          ? tool.description
                          : '未确认是查询工具，暂不开放。'}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            </details>
          )}
          {!server.discovery && server.tools.length > 0 && (
            <p className="break-words text-xs text-muted-foreground">
              已选择：{server.tools.join('、')}
            </p>
          )}
        </div>
      ))}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) {
            setOpen(value);
            if (!value) {
              setJson('');
              setImportError('');
            }
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>导入 MCP 配置</DialogTitle>
            <DialogDescription>
              支持 mcpServers、SSE、Streamable HTTP 和 Bearer
              请求头。密钥只保存在服务端。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="MCP JSON 配置"
            className="h-64 max-h-[45dvh] resize-none font-mono text-xs"
            placeholder={
              '{ "mcpServers": { "service": { "type": "sse", "url": "https://example.com/sse" } } }'
            }
            value={json}
            disabled={busy}
            onChange={(e) => setJson(e.target.value)}
          />
          <Notice error message={importError} />
          <DialogFooter>
            <Button
              disabled={busy || !json.trim()}
              onClick={async () => {
                let parsed: unknown;
                try {
                  parsed = JSON.parse(json);
                } catch {
                  setImportError('JSON 格式不完整，请检查括号和逗号。');
                  return;
                }
                setBusy(true);
                setImportError('');
                try {
                  const result = await agentApi<AgentConfig>(
                    'admin/mcp-import',
                    parsed,
                  );
                  change(result.servers);
                  setJson('');
                  setOpen(false);
                  setNotice('配置已导入，测试连接并选择工具后即可启用。');
                } catch (e) {
                  setImportError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? '正在导入…' : '导入配置'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
