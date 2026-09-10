"""本应用专用 stdio MCP；不开放网络端口，不接受模型指定身份或文件路径。"""
import json
import os
from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from mcp.types import ToolAnnotations
from .notes import NoteStore, note_result


def create_server(directory, user):
    store = NoteStore(directory, user)
    server = FastMCP('北行路书地点笔记', log_level='ERROR')
    def run(operation):
        result = note_result(operation)
        if not result['ok']:
            raise ToolError(json.dumps(result, ensure_ascii=False))
        return result

    readonly = ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False)
    writable = ToolAnnotations(readOnlyHint=False, destructiveHint=True, openWorldHint=False)

    @server.tool(annotations=readonly)
    def list_place_notes(query: str = '', day_id: str = '') -> dict:
        """查找路书地点和笔记摘要，返回真实 placeId。query 匹配地点或笔记，day_id 可填 d1 到 d6。同一地点跨日期共用笔记。"""
        return {'places': store.list(query, day_id)}

    @server.tool(annotations=readonly)
    def read_place_note(place_id: str) -> dict:
        """读取地点共同 Markdown 笔记及 version。编辑前必须读取；没有笔记时 content 为空且 version=0。"""
        return run(lambda: store.read(place_id))

    @server.tool(annotations=writable)
    def write_place_note(place_id: str, content: str, expected_version: int) -> dict:
        """用户要求时创建或保存完整 Markdown 笔记。先读取，把 version 原样作为 expected_version。保留旅伴已有内容；若发生冲突，重新读取并合并，禁止猜版本强制覆盖。最多 20000 字符。"""
        return run(lambda: store.save(place_id, content, expected_version))

    @server.tool(annotations=writable)
    def edit_place_note(place_id: str, old_text: str, new_text: str, expected_version: int) -> dict:
        """用户要求时精确替换笔记中的一段原文。原文必须只出现一次，携带读取到的 version，其他段落保持不变。冲突后重新读取，不强制覆盖。"""
        return run(lambda: store.edit(place_id, old_text, new_text, expected_version))

    return server


if __name__ == '__main__':
    os.umask(0o077)
    create_server(os.environ['AGENT_DATA_DIR'], json.loads(os.environ['NOTES_USER_JSON'])).run(transport='stdio')
