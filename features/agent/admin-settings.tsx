'use client';
import { useEffect, useState } from 'react';
import { McpSettings } from './mcp-settings';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Notice } from '@/features/accounts/shared';
import { agentApi, type AgentConfig } from './client';

export function AgentSettings() {
  const [config, setConfig] = useState<AgentConfig | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    agentApi<AgentConfig>('admin/config', undefined, controller.signal)
      .then(setConfig)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  const change = (values: Partial<AgentConfig>) => {
    setConfig((c) => (c ? { ...c, ...values } : c));
    setNotice('');
  };
  async function save() {
    const saved = await agentApi<AgentConfig>('admin/config', config);
    setConfig(saved);
    return saved;
  }
  return (
    <Card className="agent-settings">
      <CardHeader>
        <CardTitle>旅行助手</CardTitle>
        <CardDescription>
          配置模型、语音识别和 MCP 服务，供旅伴们在线查询与讨论。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Notice error message={error} />
        <Notice message={notice} />
        {!config ? (
          <p className="text-sm text-muted-foreground">正在加载配置…</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="agent-base-url">模型接口地址</FieldLabel>
                <Input
                  id="agent-base-url"
                  placeholder="https://example.com/v1"
                  value={config.baseUrl}
                  disabled={busy || config.envManaged.includes('baseUrl')}
                  onChange={(e) => change({ baseUrl: e.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="agent-model">模型名称</FieldLabel>
                <Input
                  id="agent-model"
                  placeholder="填写服务商提供的模型 ID"
                  value={config.model}
                  disabled={busy || config.envManaged.includes('model')}
                  onChange={(e) => change({ model: e.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="agent-key">API Key</FieldLabel>
                <Input
                  id="agent-key"
                  type="password"
                  autoComplete="new-password"
                  value={config.apiKey || ''}
                  disabled={busy || config.envManaged.includes('apiKey')}
                  placeholder={
                    config.keyConfigured
                      ? '已保存，留空保留原密钥'
                      : '填写接口密钥'
                  }
                  onChange={(e) => change({ apiKey: e.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="agent-embedding">
                  向量模型（选填）
                </FieldLabel>
                <Input
                  id="agent-embedding"
                  value={config.embeddingModel}
                  disabled={
                    busy || config.envManaged.includes('embeddingModel')
                  }
                  placeholder="留空使用关键词检索记忆"
                  onChange={(e) => change({ embeddingModel: e.target.value })}
                />
                <FieldDescription>
                  与对话模型共用接口和密钥，填写后启用语义检索。
                </FieldDescription>
              </Field>
            </div>
            {config.envManaged.length > 0 && (
              <p className="text-xs text-muted-foreground">
                灰色字段由环境配置管理，修改后需要重启服务。
              </p>
            )}
            <section
              className="space-y-4 border-t pt-5"
              aria-label="火山语音识别配置"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-medium">火山语音识别</h3>
                <span className="text-xs text-muted-foreground">
                  {config.speech.ready ? '已配置' : '未配置'}
                </span>
              </div>
              <Field>
                <FieldLabel htmlFor="speech-api-key">语音 API Key</FieldLabel>
                <Input
                  id="speech-api-key"
                  type="password"
                  autoComplete="new-password"
                  value={config.speech.apiKey || ''}
                  disabled={busy || config.speech.envManaged.includes('apiKey')}
                  placeholder={
                    config.speech.keyConfigured
                      ? '已保存，留空保留原密钥'
                      : '填写豆包语音新版控制台的 API Key'
                  }
                  onChange={(e) =>
                    change({
                      speech: { ...config.speech, apiKey: e.target.value },
                    })
                  }
                />
                <FieldDescription>
                  开通“录音文件识别极速版”后填写语音服务的密钥。独立于上面的对话模型密钥。
                  <a
                    href="https://www.volcengine.com/docs/6561/1631584?lang=zh"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 underline"
                  >
                    查看开通说明
                  </a>
                </FieldDescription>
              </Field>
              <details className="rounded-xl border p-4">
                <summary className="cursor-pointer text-sm">
                  旧版控制台凭据
                </summary>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="speech-app-id">App ID</FieldLabel>
                    <Input
                      id="speech-app-id"
                      value={config.speech.appId}
                      disabled={
                        busy || config.speech.envManaged.includes('appId')
                      }
                      onChange={(e) =>
                        change({
                          speech: { ...config.speech, appId: e.target.value },
                        })
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="speech-token">Access Token</FieldLabel>
                    <Input
                      id="speech-token"
                      type="password"
                      autoComplete="new-password"
                      value={config.speech.accessToken || ''}
                      disabled={
                        busy || config.speech.envManaged.includes('accessToken')
                      }
                      placeholder={
                        config.speech.tokenConfigured
                          ? '已保存，留空保留原密钥'
                          : '填写语音服务的 Access Token'
                      }
                      onChange={(e) =>
                        change({
                          speech: {
                            ...config.speech,
                            accessToken: e.target.value,
                          },
                        })
                      }
                    />
                  </Field>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  旧版需要同时填写两项；已配置新版 API Key 时优先使用新版。
                </p>
              </details>
              {config.speech.envManaged.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  灰色字段由环境配置管理，修改后需要重启服务。
                </p>
              )}
            </section>
            <McpSettings
              servers={config.servers}
              busy={busy}
              setBusy={setBusy}
              change={(servers) => change({ servers })}
              save={save}
            />
          </>
        )}
      </CardContent>
      <CardFooter>
        <Button
          disabled={busy || !config}
          onClick={async () => {
            setBusy(true);
            setError('');
            setNotice('');
            try {
              await save();
              setNotice('配置已保存，下一次助手回复会使用新配置。');
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? '正在处理…' : '保存助手配置'}
        </Button>
      </CardFooter>
    </Card>
  );
}
