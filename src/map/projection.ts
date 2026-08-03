import * as d3 from 'd3';
import type { Point } from '@/logic/layout';

export function createProjection(width: number, height: number): d3.GeoProjection {
  return d3.geoMercator()
    .center([104, 38])
    .scale(Math.min(width, height) * 0.8)
    .translate([width / 2, height / 2]);
}

export function getProjectedPoint(projection: d3.GeoProjection, lat: number, lng: number): Point | null {
  const coords = projection([lng, lat]);
  return coords ? { x: coords[0], y: coords[1] } : null;
}
