export type MapPosition = [number, number];

/** 只接受有限数值坐标；空值和 SDK 异常结果不能转换成地图像素。 */
export function mapPosition(value: unknown): MapPosition | null {
  let lng: unknown, lat: unknown;
  if (Array.isArray(value)) {
    [lng, lat] = value;
  } else if (value && typeof value === 'object') {
    const point = value as {
      lng?: unknown;
      lat?: unknown;
      getLng?: () => unknown;
      getLat?: () => unknown;
    };
    lng = typeof point.getLng === 'function' ? point.getLng() : point.lng;
    lat = typeof point.getLat === 'function' ? point.getLat() : point.lat;
  }
  if (
    typeof lng !== 'number' ||
    typeof lat !== 'number' ||
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    Math.abs(lng) > 180 ||
    Math.abs(lat) > 90
  )
    return null;
  return [lng, lat];
}

export type CompletingMap = {
  on: (event: 'complete', callback: () => void) => void;
  off: (event: 'complete', callback: () => void) => void;
};

/** 地图构造是异步的；旧实例销毁后，迟到的 complete 不能激活新页面。 */
export function whenMapComplete(
  map: CompletingMap,
  onReady: () => void,
  onTimeout: () => void,
  timeoutMs = 20000,
): () => void {
  let disposed = false,
    completed = false;
  const timer = setTimeout(() => {
    if (!disposed && !completed) onTimeout();
  }, timeoutMs);
  const complete = () => {
    if (disposed || completed) return;
    completed = true;
    clearTimeout(timer);
    map.off('complete', complete);
    onReady();
  };
  map.on('complete', complete);
  return () => {
    disposed = true;
    clearTimeout(timer);
    map.off('complete', complete);
  };
}
