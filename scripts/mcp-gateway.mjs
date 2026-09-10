import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

export class McpGateway {
  constructor(env = process.env) {
    this.env = env;
  }
  async ready() {
    if (this.closed) throw new Error('MCP 网关已关闭');
    if (this.env.MCP_GATEWAY_URL) {
      if (!this.env.MCP_GATEWAY_TOKEN)
        throw new Error('请配置 MCP 网关连接密钥');
      const url = new URL(this.env.MCP_GATEWAY_URL);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error('MCP 网关地址无效');
      return {
        url: url.href.replace(/\/$/, ''),
        token: this.env.MCP_GATEWAY_TOKEN,
      };
    }
    if (this.pending) return this.pending;
    const token = randomBytes(32).toString('hex');
    this.pending = new Promise((yes, no) => {
      const child = spawn(
        this.env.AGENT_PYTHON || resolve('.venv/bin/python'),
        ['-m', 'agent.mcp_gateway'],
        {
          cwd: process.cwd(),
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            PATH: process.env.PATH,
            LANG: 'en_US.UTF-8',
            PYTHONUNBUFFERED: '1',
            MCP_GATEWAY_TOKEN: token,
            MCP_FLIGGY_COMMAND:
              this.env.MCP_FLIGGY_COMMAND ||
              resolve('.runtime/mcp/fliggy/bin/mcp-fliggy-travel'),
          },
        },
      );
      this.child = child;
      const timer = setTimeout(() => {
        child.kill();
        no(new Error('MCP 网关启动超时'));
      }, 20000);
      const fail = () => {
        clearTimeout(timer);
        if (this.child === child) this.pending = null;
        no(new Error('MCP 网关不可用，请检查 Python 运行环境'));
      };
      child.once('error', fail);
      child.once('exit', fail);
      child.stderr.on('data', () => {});
      createInterface({ input: child.stdout }).on('line', (line) => {
        try {
          const data = JSON.parse(line);
          if (data.ready && Number.isInteger(data.port)) {
            clearTimeout(timer);
            yes({ url: `http://127.0.0.1:${data.port}`, token });
          }
        } catch {
          /* Ignore upstream logging. */
        }
      });
    });
    return this.pending;
  }
  async request(method, server, values = {}) {
    const gateway = await this.ready();
    let response, data;
    try {
      response = await fetch(gateway.url + '/rpc', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(45000),
        headers: {
          Authorization: 'Bearer ' + gateway.token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method, server, ...values }),
      });
      data = await response.json();
    } catch {
      throw new Error('MCP 网关连接失败或超时，请检查运行环境');
    }
    if (!response.ok) throw new Error(data.error || 'MCP 连接失败');
    return data;
  }
  close() {
    this.closed = true;
    this.child?.kill();
    this.pending = null;
  }
}
