"""独立 MCP 微服务；只接受路书后端的受保护请求，不保存账户或聊天。"""
import asyncio
import contextlib
import hmac
import json
import logging
import os
import socket
import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from .mcp_runtime import upstream_tools, describe, alias, readonly, safe_error

TOKEN = os.environ.get('MCP_GATEWAY_TOKEN', '')
SLOTS = asyncio.Semaphore(8)


async def rpc(request: Request):
    if not TOKEN or not hmac.compare_digest(request.headers.get('authorization', '').encode(), ('Bearer ' + TOKEN).encode()):
        return JSONResponse({'error': '网关身份验证失败'}, status_code=401)
    if request.method == 'GET':
        return JSONResponse({'ok': True})
    try:
        raw = b''
        async with asyncio.timeout(10):
            async for chunk in request.stream():
                raw += chunk
                if len(raw) > 160000:
                    return JSONResponse({'error': '请求过大'}, status_code=413)
        body = json.loads(raw)
        server = body['server']
        async with asyncio.timeout(40):
            async with SLOTS:
                tools = await upstream_tools(server)
                if body['method'] == 'list':
                    result = {'tools': [describe(server, t) for t in tools]}
                elif body['method'] == 'call':
                    tool = next((t for t in tools if alias(t.name) == body['name']), None)
                    if not tool or not readonly(server, tool) or body['name'] not in server.get('tools', []):
                        return JSONResponse({'error': '此工具未启用或不属于查询工具'}, status_code=403)
                    output = await tool.ainvoke(body.get('arguments', {}))
                    content = getattr(output, 'content', output)
                    result = {'content': content}
                else:
                    return JSONResponse({'error': '未知操作'}, status_code=400)
        # Never echo secrets even if an upstream tool includes headers in its output.
        value = json.dumps(result, ensure_ascii=False, default=str)
        for secret in [server.get('token'), *[h.get('value') for h in server.get('headers', [])]]:
            if secret:
                value = value.replace(json.dumps(secret, ensure_ascii=False)[1:-1], '[已隐藏]')
        if len(value) > 1000000:
            return JSONResponse({'error': '工具返回过大，请缩小查询范围'}, status_code=502)
        return JSONResponse(json.loads(value), headers={'Cache-Control': 'no-store'})
    except Exception as error:
        return JSONResponse({'error': safe_error(error)}, status_code=502)


app = Starlette(routes=[Route('/health', rpc, methods=['GET']), Route('/rpc', rpc, methods=['POST'])])


def main():
    if not TOKEN:
        raise SystemExit('MCP_GATEWAY_TOKEN 未配置')
    logging.disable(logging.CRITICAL)
    sock = socket.socket()
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((os.environ.get('MCP_GATEWAY_HOST', '127.0.0.1'), int(os.environ.get('MCP_GATEWAY_PORT', '0'))))
    sock.listen(128)
    print(json.dumps({'ready': True, 'port': sock.getsockname()[1]}), flush=True)
    config = uvicorn.Config(app, access_log=False, log_level='critical')
    server = uvicorn.Server(config)
    # Child MCP libraries log only into stderr, which the parent discards.
    with contextlib.redirect_stdout(__import__('sys').stderr):
        server.run(sockets=[sock])


if __name__ == '__main__':
    main()
