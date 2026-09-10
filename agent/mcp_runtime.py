"""MCP 上游连接与工具适配；由独立网关进程执行。"""
import asyncio
import hashlib
import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit
import httpx
from langchain_mcp_adapters.client import MultiServerMCPClient

PRESETS = json.loads((Path(__file__).resolve().parent.parent / 'data/mcp-presets.json').read_text())


def alias(name):
    if re.fullmatch(r'[A-Za-z0-9_-]{1,64}', name):
        return name
    prefix = re.sub(r'[^a-zA-Z0-9_]', '_', name.split('_')[0])[:20]
    return prefix + '_tool_' + hashlib.sha256(name.encode()).hexdigest()[:12]


def readonly(server, tool):
    annotations = tool.metadata or {}
    if annotations.get('readOnlyHint') is True:
        return True
    if annotations.get('readOnlyHint') is False:
        return False
    preset = next((p for p in PRESETS if p['id'] == server['id']), None)
    if not preset:
        return False
    target = urlsplit(server.get('url', ''))
    known = (preset.get('url') and server.get('url') == preset['url']) or (
        preset['id'] == 'amap' and target.scheme == 'https' and target.hostname == preset.get('host') and target.path.endswith('/sse'))
    if preset.get('runtime') == 'fliggy':
        known = server.get('transport') == 'stdio' and server.get('proxyApproved') is True
    raw = tool.name.removeprefix(server['id'] + '_')
    return bool(known and raw in preset.get('reviewedTools', []))


async def upstream_tools(server):
    transport = server.get('transport', 'streamable_http')
    if transport == 'stdio':
        if server.get('id') != 'fliggy' or not server.get('proxyApproved'):
            raise ValueError('飞猪接入方式待确认')
        command = os.environ.get('MCP_FLIGGY_COMMAND', str(Path('.runtime/mcp/fliggy/bin/mcp-fliggy-travel').resolve()))
        if not Path(command).is_file():
            raise ValueError('飞猪运行环境尚未安装')
        connection = {'transport': 'stdio', 'command': command, 'args': [],
                      'env': {'FLYAI_API_KEY': server.get('token', ''), 'PATH': os.environ.get('PATH', '')}}
    else:
        if transport not in ('sse', 'streamable_http'):
            raise ValueError('连接类型无效')
        target = urlsplit(server['url'])
        headers = {h['name']: h['value'] for h in server.get('headers', []) if h.get('value')}
        if server.get('token'):
            headers['Authorization'] = 'Bearer ' + server['token']

        async def check_origin(request):
            parsed = urlsplit(str(request.url))
            if (parsed.scheme, parsed.netloc) != (target.scheme, target.netloc):
                raise ValueError('MCP 不允许跨域转发凭据')

        def http_client(**kwargs):
            kwargs['follow_redirects'] = False
            return httpx.AsyncClient(**kwargs, event_hooks={'request': [check_origin]})

        connection = {'transport': transport, 'url': server['url'], 'headers': headers,
                      'timeout': 15, 'sse_read_timeout': 30, 'httpx_client_factory': http_client}
    client = MultiServerMCPClient({server['id']: connection}, tool_name_prefix=True)
    async with asyncio.timeout(30):
        return await client.get_tools()


def describe(server, tool):
    return {'name': alias(tool.name), 'sourceName': tool.name, 'description': tool.description[:2000],
            'schema': tool.args_schema if isinstance(tool.args_schema, dict) else tool.args_schema.model_json_schema(),
            'readOnly': readonly(server, tool)}


def safe_error(error):
    if isinstance(error, BaseExceptionGroup):
        return safe_error(error.exceptions[0])
    if isinstance(error, httpx.HTTPStatusError):
        status = error.response.status_code
        if status in (401, 403):
            return '鉴权失败，请检查密钥或服务是否已开通'
        return f'MCP 服务返回 HTTP {status}'
    if isinstance(error, (TimeoutError, httpx.TimeoutException)):
        return 'MCP 连接超时，请稍后再试'
    if isinstance(error, RuntimeError) and 'task_status.started' in str(error):
        return '服务关闭了 SSE 连接，未返回会话地址；请检查服务是否开通或更换地址'
    if isinstance(error, ValueError) and str(error) in ('飞猪接入方式待确认', '飞猪运行环境尚未安装', 'MCP 不允许跨域转发凭据'):
        return str(error)
    return 'MCP 连接失败，请检查地址、连接类型和服务开通状态'
