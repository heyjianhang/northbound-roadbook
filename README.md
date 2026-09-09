# 北行路书

2026 年 10 月 1—6 日呼伦贝尔自驾路书。行程与帖子为固定内容；路线页使用高德底图，支持全程/当天视野、六色路线、地点卡片与按需持续定位。

## 运行

```sh
npm ci
# 将 .env.example 复制为 .env.local，填写高德 Web端 Key 与安全密钥
npm run build
npm start
```

打开 http://127.0.0.1:4173/ 。Node 服务提供网页和同源高德安全代理。安全密钥保存在服务端，配置修改后重启服务。开发可用 `npm run dev`。部署与定位说明见 `docs/高德地图配置.md`。

当前发行包为 `release/northbound-roadbook-0.3.3-amap.zip`；其中不包含密钥。旧的 `0.3.3-static.zip` 是此前纯静态地图版本，不是当前高德版。

## 内容与页面

- `data/roadbook.json`：固定六天地点、日期和参考里程。
- `data/place-posts.json`：11 个地点、52 篇不同小红书帖子，53 条地点关联；点击打开原帖。
- `data/day-photos.json`：每日实景配图与版权来源。
- `data/map-routes.json`：预先保存的 OSRM 道路参考轨迹；显示在高德底图前转换为 GCJ-02，并非实时高德算路结果。
- `data/map-centers.json`：未确定具体落脚点时的城区/镇区参考坐标，不改变高德关键词找地点行为。
- `features/static-roadbook/`：每日路书、整屏地图、地点帖子及返回来源处理。
- `scripts/serve.mjs`、`scripts/amap-proxy.mjs`：静态页面托管和高德配置/安全代理。

地图进入帖子后返回会恢复原地图日期、视野和所选地点；路书进入则返回路书。定位按需启动，离开路线页停止，不记录行驶轨迹。安装与离线页面已移除，原有自身资源缓存与自动更新仍保留，高德资源不被缓存。

网页没有行程编辑和数据库操作；旧版相关源码保留作历史参考，归档为 `release/northbound-source-0.2.1.tar.gz`。

## 检查

```sh
npm run typecheck
npm run lint
node --test tests/proxy.test.mjs tests/serve.test.mjs tests/route-map.test.mjs
node scripts/test-provider.mjs
npm run build
node scripts/verify-production.mjs http://127.0.0.1:4173
```

本次高德底图与帖子返回已在浏览器验证；真实定位仍返回超时，未宣称真机定位或移动跟踪已验证。未部署远程服务器。
