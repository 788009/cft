function ringArea(ring: number[][]): number {
  let area = 0;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    area += (previousPoint[0] - currentPoint[0]) * (previousPoint[1] + currentPoint[1]);
  }
  return area;
}

export function rewindFeature<T>(feature: T): T {
  if (!feature || typeof feature !== 'object' || !('geometry' in feature)) return feature;

  const cloned = structuredClone(feature) as T & {
    geometry?: { type?: string; coordinates?: number[][][] | number[][][][] };
  };
  const geometry = cloned.geometry;
  if (!geometry?.coordinates) return cloned;

  const fixPolygon = (rings: number[][][]): void => {
    if (rings.length === 0) return;
    if (ringArea(rings[0]) > 0) rings[0].reverse();
    for (const ring of rings.slice(1)) {
      if (ringArea(ring) < 0) ring.reverse();
    }
  };

  if (geometry.type === 'Polygon') {
    fixPolygon(geometry.coordinates as number[][][]);
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates as number[][][][]) fixPolygon(polygon);
  }
  return cloned;
}
