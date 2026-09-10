"""Agent 只拿到工具描述，通过内网 MCP 网关执行工具。"""
import httpx
from langchain_core.tools import StructuredTool, ToolException
from .mcp_runtime import upstream_tools


async def gateway_request(gateway, method, server, **kwargs):
    async with httpx.AsyncClient(timeout=45, follow_redirects=False) as client:
        response = await client.post(gateway['url'] + '/rpc', headers={'Authorization': 'Bearer ' + gateway['token']},
                                     json={'method': method, 'server': server, **kwargs})
        data = response.json()
        if not response.is_success:
            raise ToolException(data.get('error', 'MCP 网关暂时不可用'))
        return data


async def mcp_tools(server, gateway=None):
    if not gateway:
        # Used by focused runtime tests and standalone worker development.
        return await upstream_tools(server)
    items = (await gateway_request(gateway, 'list', server))['tools']
    tools = []
    for item in items:
        def make_call(name):
            async def call(**arguments):
                result = await gateway_request(gateway, 'call', server, name=name, arguments=arguments)
                return result['content']
            return call
        tools.append(StructuredTool(name=item['name'], description=item['description'], args_schema=item['schema'],
                                    coroutine=make_call(item['name']), metadata={'readOnlyHint': item['readOnly'], 'sourceName': item['sourceName']}, handle_tool_error=True))
    return tools
