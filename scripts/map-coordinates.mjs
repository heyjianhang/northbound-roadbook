// Convert the roadbook's GCJ-02 coordinates to the WGS84 used by OSM/GPS.
export function wgsToGcj([lng, lat]) {
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271)
    return [lng, lat];
  const x = lng - 105,
    y = lat - 35,
    pi = Math.PI;
  const common =
    ((20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2) / 3;
  let dLat =
    -100 +
    2 * x +
    3 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x)) +
    common;
  dLat += ((20 * Math.sin(y * pi) + 40 * Math.sin((y / 3) * pi)) * 2) / 3;
  dLat +=
    ((160 * Math.sin((y / 12) * pi) + 320 * Math.sin((y * pi) / 30)) * 2) / 3;
  let dLng =
    300 +
    x +
    2 * y +
    0.1 * x * x +
    0.1 * x * y +
    0.1 * Math.sqrt(Math.abs(x)) +
    common;
  dLng += ((20 * Math.sin(x * pi) + 40 * Math.sin((x / 3) * pi)) * 2) / 3;
  dLng +=
    ((150 * Math.sin((x / 12) * pi) + 300 * Math.sin((x / 30) * pi)) * 2) / 3;
  const rad = (lat * pi) / 180,
    magic = 1 - 0.006693421622965943 * Math.sin(rad) ** 2;
  dLat =
    (dLat * 180) /
    (((6378245 * (1 - 0.006693421622965943)) / (magic * Math.sqrt(magic))) *
      pi);
  dLng = (dLng * 180) / ((6378245 / Math.sqrt(magic)) * Math.cos(rad) * pi);
  return [lng + dLng, lat + dLat];
}
export function gcjToWgs(point) {
  let result = [...point];
  for (let i = 0; i < 5; i++) {
    const shifted = wgsToGcj(result);
    result = [
      result[0] + point[0] - shifted[0],
      result[1] + point[1] - shifted[1],
    ];
  }
  return result.map((n) => Number(n.toFixed(6)));
}
