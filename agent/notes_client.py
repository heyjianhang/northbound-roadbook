"""把受信任的内置笔记 MCP 自动接入 Agent，身份来自本轮发言者。"""
import asyncio
import json
import os
import sys
from pathlib import Path
from langchain_mcp_adapters.client import MultiServerMCPClient
from .notes import identity


async def note_tools(directory, user):
    identity(user)
    client = MultiServerMCPClient({'notes': {
        'transport': 'stdio', 'command': sys.executable, 'args': ['-m', 'agent.notes_mcp'],
        'cwd': str(Path(__file__).resolve().parent.parent),
        'env': {'AGENT_DATA_DIR': str(Path(directory).resolve()), 'NOTES_USER_JSON': json.dumps(user),
                'PATH': os.environ.get('PATH', ''), 'PYTHONDONTWRITEBYTECODE': '1'},
    }}, tool_name_prefix=True)
    async with asyncio.timeout(15):
        return await client.get_tools()
