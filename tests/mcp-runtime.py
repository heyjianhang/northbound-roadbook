"""网关身份校验、工具权限与中文名称兼容性回归测试。"""
import unittest
from unittest.mock import patch
import httpx
from langchain_core.tools import StructuredTool
from agent import mcp_gateway
from agent.mcp_runtime import alias, describe, readonly


async def query(city: str):
    return f'{city}，凭据 provider-secret 和 header-secret'


def make_tool(name='推荐美食.', hint=None):
    return StructuredTool(name=name, description='查询当地美食', coroutine=query,
                          args_schema={'type': 'object', 'properties': {'city': {'type': 'string'}}, 'required': ['city']},
                          metadata={} if hint is None else {'readOnlyHint': hint})


class GatewayTests(unittest.IsolatedAsyncioTestCase):
    def test_reviewed_queries_require_known_origin_and_never_override_false(self):
        server = {'id': 'market', 'url': 'https://dashscope.aliyuncs.com/api/v1/mcps/market-cmapi00067124/mcp'}
        tool = make_tool('market_推荐美食.')
        self.assertTrue(readonly(server, tool))
        self.assertFalse(readonly({**server, 'url': 'https://custom.example/mcp'}, tool))
        self.assertFalse(readonly(server, make_tool('market_推荐美食.', False)))
        self.assertFalse(readonly(server, make_tool('market_删除订单')))
        self.assertEqual(alias(tool.name), alias(tool.name))
        self.assertRegex(alias(tool.name), r'^[A-Za-z0-9_-]{1,64}$')
        self.assertEqual(describe(server, tool)['sourceName'], tool.name)

    async def test_authenticated_gateway_lists_calls_filters_and_redacts(self):
        server = {'id': 'custom', 'url': 'https://provider.example/mcp', 'token': 'provider-secret',
                  'headers': [{'name': 'X-Key', 'value': 'header-secret'}], 'tools': [alias('custom_推荐美食.')]}
        tools = [make_tool('custom_推荐美食.', True), make_tool('custom_delete', False)]
        async def discover(_server): return tools
        transport = httpx.ASGITransport(app=mcp_gateway.app)
        with patch.object(mcp_gateway, 'TOKEN', 'gateway-secret'), patch.object(mcp_gateway, 'upstream_tools', discover):
            async with httpx.AsyncClient(transport=transport, base_url='http://gateway') as c:
                self.assertEqual((await c.get('/health')).status_code, 401)
                c.headers['Authorization'] = 'Bearer gateway-secret'
                self.assertEqual((await c.get('/health')).status_code, 200)
                result = await c.post('/rpc', json={'method': 'list', 'server': server})
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.json()['tools'][0]['name'], server['tools'][0])
                self.assertFalse(result.json()['tools'][1]['readOnly'])
                result = await c.post('/rpc', json={'method': 'call', 'server': server, 'name': server['tools'][0], 'arguments': {'city': '呼伦贝尔'}})
                self.assertEqual(result.status_code, 200)
                self.assertIn('呼伦贝尔', result.text)
                self.assertNotIn('provider-secret', result.text)
                self.assertNotIn('header-secret', result.text)
                for name in ['custom_delete', 'missing']:
                    result = await c.post('/rpc', json={'method': 'call', 'server': {**server, 'tools': [name]}, 'name': name, 'arguments': {}})
                    self.assertEqual(result.status_code, 403)
                result = await c.post('/rpc', json={'method': 'call', 'server': {**server, 'tools': []}, 'name': server['tools'][0], 'arguments': {'city': '测试'}})
                self.assertEqual(result.status_code, 403)


if __name__ == '__main__': unittest.main()
