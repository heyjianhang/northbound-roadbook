// 相同请求合并，短期缓存；搜索与路线共享节流，避免长途规划突发耗尽 QPS。
const entries = new Map<string, { at: number; promise: Promise<unknown> }>();
let queue: Promise<unknown> = Promise.resolve();
let lastStart = 0;
export function invalidateMapQuery(key: string) { entries.delete(key); }
export function cachedMapQuery<T>(
  key: string,
  query: () => Promise<T>,
): Promise<T> {
  const cached = entries.get(key);
  if (cached && Date.now() - cached.at < 300000)
    return cached.promise as Promise<T>;
  const promise = queue
    .catch(() => {})
    .then(async () => {
      const wait = Math.max(0, 800 - (Date.now() - lastStart));
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      lastStart = Date.now();
      return query();
    });
  queue = promise.catch(() => {});
  entries.set(key, { at: Date.now(), promise });
  if (entries.size > 400) entries.delete(entries.keys().next().value!);
  void promise.catch(() => {
    if (entries.get(key)?.promise === promise) entries.delete(key);
  });
  return promise;
}
