# 路书 JSON v3

根对象包含 `schemaVersion: 3`、`coordinateSystem: "GCJ-02"`、行程 ID/标题/日期/人数/更新时间、`days`、`links`、`unscheduled`、`routeRecords`。

每一天具有 `id`、`date`、`title`、`subtitle`、`note` 和有序 `stops`。每个 Stop 是独立停靠记录：

```json
{
  "id": "stop-example",
  "name": "想去的地方",
  "lng": null,
  "lat": null,
  "amapId": "",
  "area": "根河",
  "durationMin": 60,
  "note": "停车入口和随手记",
  "links": []
}
```

没有优先级、固定起终点或启用开关。数组顺序就是游览顺序，同一个 POI 再次出现使用新的 Stop ID。每一天允许 0–100 个地点。经纬度同时填写或同时为 null；时间范围 0–1440 分钟。

攻略记录为 `{id, title, url, note}`，URL 仅接受 http/https。

路线记录为 `{key, from, to, policy, distanceKm, drivingMin, path, checkedAt, source}`。`from`/`to` 是 `[lng,lat]`，`policy` 为 0，key 为 `driving:0:经度,纬度>经度,纬度`；方向不同不能复用。path 是简化展示轨迹，道路里程来自查询返回，不通过折线计算。空 path 的历史里程可作为原路书参考，联网后补查道路轨迹。

导出文件包含路线缓存；IndexedDB 内路书本体、路线缓存及备份分开存储。缓存数组顺序不表示行驶顺序。

导入最大 10 MB，完整校验后才能预览并替换。v1/v2 通过迁移器导入：将启用的 visits 依次转换为独立 Stop，停用或未安排资料保留到 unscheduled，不自动加回行程；旧数据原文在迁移前备份。旧的等级值不进入 v3 模型，原备注原文会保留。
