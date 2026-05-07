/** Convert lat/lng to a quadkey at a given zoom level (Ookla uses zoom 16). */
export function latLngToQuadkey(lat: number, lng: number, zoom: number): string {
  let qk = "";
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const pixelX = ((lng + 180) / 360) * 256 * Math.pow(2, zoom);
  const pixelY =
    (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) *
    256 *
    Math.pow(2, zoom);
  const tileX = Math.floor(pixelX / 256);
  const tileY = Math.floor(pixelY / 256);

  for (let i = zoom; i > 0; i--) {
    let digit = 0;
    const mask = 1 << (i - 1);
    if ((tileX & mask) !== 0) digit += 1;
    if ((tileY & mask) !== 0) digit += 2;
    qk += digit.toString();
  }
  return qk;
}
