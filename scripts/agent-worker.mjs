import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { agentDirectory } from './agent-store.mjs';

export class AgentWorker {
  constructor(env = process.env) {
    this.env = env;
    this.pending = new Map();
  }
  start() {
    if (this.child) return;
    const child = spawn(
      this.env.AGENT_PYTHON || resolve('.venv/bin/python'),
      ['-m', 'agent.worker'],
      {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        // The worker never receives administrator credentials or unrelated application secrets.
        env: {
          PATH: process.env.PATH,
          LANG: 'en_US.UTF-8',
          PYTHONUNBUFFERED: '1',
          AGENT_DATA_DIR: agentDirectory(this.env),
          LANGSMITH_TRACING: 'false',
          LANGCHAIN_TRACING_V2: 'false',
        },
      },
    );
    this.child = child;
    const fail = () => {
      if (this.child !== child) return;
      this.child = null;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(
          new Error('助手运行环境不可用，请安装 Python 依赖或重新启动服务'),
        );
      }
      this.pending.clear();
    };
    child.once('error', fail);
    child.once('exit', fail);
    child.stdin.on('error', fail);
    child.stderr.on('data', () => {});
    createInterface({ input: child.stdout }).on('line', (line) => {
      let data;
      try {
        data = JSON.parse(line);
      } catch {
        return;
      }
      const p = this.pending.get(data.id);
      if (!p) return;
      if (data.event) {
        p.onEvent?.(data.event);
        return;
      }
      clearTimeout(p.timer);
      this.pending.delete(data.id);
      if (data.error) p.reject(new Error(data.error));
      else p.resolve(data.result);
    });
  }
  request(method, params, onEvent, id = randomUUID()) {
    this.start();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.cancel(id);
          this.pending.delete(id);
          reject(new Error('助手请求超时，请重试'));
        },
        method === 'run' ? 255000 : 50000,
      );
      this.pending.set(id, { resolve, reject, onEvent, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  cancel(id) {
    this.child?.stdin.write(
      JSON.stringify({ id: randomUUID(), method: 'cancel', params: { id } }) +
        '\n',
    );
  }
  close() {
    this.child?.kill();
  }
}
