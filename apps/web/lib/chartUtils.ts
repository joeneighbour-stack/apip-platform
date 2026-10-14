// Shared chart data helpers.

// Recharts renders every point in `data` to SVG regardless of pixel width available --
// a "Since Inception" series with tens of thousands of trade-by-trade points costs real
// render time for visual detail no one can see at screen or A4 print width. Downsampling
// to a fixed point count keeps the chart visually identical while bounding render cost.
export function downsample<T>(data: T[], maxPoints: number): T[] {
  if (data.length <= maxPoints) return data
  const step = data.length / maxPoints
  return Array.from({ length: maxPoints }, (_, i) => data[Math.round(i * step)])
}
