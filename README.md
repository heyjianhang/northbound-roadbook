# 北行路书

2026 年 10 月 1—6 日呼伦贝尔自驾路书。行程与帖子为固定内容；路线页使用高德底图，支持全程/当天视野、六色路线、地点卡片与按需持续定位。

## 运行

```sh
npm ci
python3.12 -m venv .venv
.venv/bin/pip install -r agent/requirements.txt
# 将 .env.example 复制为 .env.local，填写高德 Web端 Key、安全密钥和 ADMIN_USERNAME / ADMIN_PASSWORD
npm run build
npm start
```

打开 http://127.0.0.1:4173/ 。Node 服务提供网页和同源高德安全代理。安全密钥保存在服务端，配置修改后重启服务。开发可用 `npm run dev`。部署与定位说明见 `docs/高德地图配置.md`。

旅行助手需要 Python 3.11+；也可以使用 `uv venv --python 3.12 .venv` 和 `uv pip install -r agent/requirements.txt` 安装。Node 自动启动 Python worker，不需要另外运行一个 API 服务。

当前发行包为 `release/northbound-roadbook-0.3.3-amap.zip`；其中不包含密钥。旧的 `0.3.3-static.zip` 是此前纯静态地图版本，不是当前高德版。

## 账户

账户采用邀请注册。独立管理员在 `.env.local` 中配置 `ADMIN_USERNAME`、`ADMIN_PASSWORD`，可选 `ADMIN_NAME`，重启生效。管理员登录后只进入成员管理页，为自己和旅伴分别生成邀请。每个人通过邀请注册普通成员账号，日常用成员账号进入路书，在“账户”页编辑名字、头像和密码。管理员密码只能通过环境配置修改。

账户数据保存在 `.runtime/accounts.sqlite`；对外部署需配置 `PUBLIC_ORIGIN` 为实际 HTTPS 地址并持久化数据库目录。账户详情、密码恢复和 Docker 用法见 [账户系统](docs/账户系统.md)。此前的 0.3.3 发行包不含账户功能，应从当前源码重新构建。

## 内容与页面

“助手”提供服务端保存的共同对话，前端复用 AI Elements，后端使用 Deep Agents + LangMem。管理员在成员管理页下方配置 OpenAI 兼容接口（需支持流式 Chat Completions 和工具调用），填写地址、模型名与 API Key，即可开始使用。

MCP 支持 SSE、Streamable HTTP 和 JSON 导入，预置高德天气与地图、智谱搜索、美食推荐和飞猪入口。管理员配置凭据、测试连接、选择查询工具后启用；飞猪命令运行环境需先确认接入方式。连接层独立运行，可用 `compose.yaml` 拆分为 MCP 微服务。所有旅伴共同维护同一个记忆库，可在助手的“记忆”面板添加、编辑、删除条目；配置向量模型后支持语义检索，否则使用关键词检索。配置与数据持久化在 `.runtime/agent/`。具体使用方式和运行边界见 [旅行助手](docs/旅行助手.md)。

输入框支持火山语音转文字：管理员开通“录音文件识别极速版”，在同一管理页面配置语音 API Key（或旧版 App ID 与 Access Token）。录音最多 60 秒，识别后回填草稿再发送，需 HTTPS 和麦克风权限。自己的消息为米色，其他旅伴的消息为浅绿色。

- `data/roadbook.json`：固定六天地点、日期和参考里程。
- `data/place-posts.json`：11 个地点、52 篇不同小红书帖子，53 条地点关联；点击打开原帖。
- `data/day-photos.json`：每日实景配图与版权来源。
- `data/map-routes.json`：预先保存的 OSRM 道路参考轨迹；显示在高德底图前转换为 GCJ-02，并非实时高德算路结果。
- `data/map-centers.json`：未确定具体落脚点时的城区/镇区参考坐标，不改变高德关键词找地点行为。
- `features/static-roadbook/`：每日路书、整屏地图、地点帖子及返回来源处理。
- `scripts/serve.mjs`、`scripts/amap-proxy.mjs`：静态页面托管和高德配置/安全代理。

地图进入帖子后返回会恢复原地图日期、视野和所选地点；路书进入则返回路书。定位按需启动，离开路线页停止，不记录行驶轨迹。账户页提供安装入口：支持时触发浏览器安装提示，iPhone 显示添加到主屏幕步骤。应用自身资源缓存与自动更新保留，高德资源不被缓存。

手机点击小红书帖子直接唤起小红书 App 对应帖子；点击高德导航或找地点，直接进入高德 App 导航或搜索。iPhone 与安卓分别使用对应的 App 链接，在当前窗口触发，不显示选择弹窗或预先创建空白标签。手机需已安装对应 App，系统可能要求确认打开；桌面保留网页入口。返回应用时会节流检查更新，保留当前路书地址。

路书仍没有行程编辑；账户已有服务端 SQLite 存储。旧版相关源码保留作历史参考，归档为 `release/northbound-source-0.2.1.tar.gz`。

地点详情支持“帖子 / 笔记”标签切换。所有旅伴共享 Markdown 笔记，内置笔记 MCP 让助手可按要求创建和编辑；同名地点跨日期共用内容，保存时检查版本以避免覆盖他人更新。

## 检查

```sh
npm run typecheck
npm run lint
npm test
.venv/bin/python -m unittest agent.test_memory agent.test_notes -v
PYTHONPATH=. .venv/bin/python tests/mcp-runtime.py
node --test tests/agent-runtime.integration.mjs
node --test tests/proxy.test.mjs tests/serve.test.mjs tests/route-map.test.mjs
node scripts/test-provider.mjs
npm run build
node scripts/verify-production.mjs http://127.0.0.1:4173
```

助手运行测试使用本地 OpenAI 兼容接口和 MCP 测试服务，不调用真实模型账户。真实服务商和移动端 PWA 的联网表现需配置后验证。未部署远程服务器。
