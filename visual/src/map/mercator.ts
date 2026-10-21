"use strict";

import { geoMercator, GeoProjection } from "d3-geo";
import { ZoomTransform } from "d3-zoom";

/** Web Mercator world size in px at k = 1 (Bing zoom level 0); k = 2^zoom. */
export const WORLD = 256;
export const MAX_LAT = 85.05112878;
/** The original flow engine lays flows out in Bing zoom-level-20 pixels. */
export const LEVEL20 = 2 ** 20;

export interface View {
    W: number;
    H: number;
    t: ZoomTransform;
}

export function baseX(lon: number): number {
    return (lon + 180) / 360 * WORLD;
}

export function baseY(lat: number): number {
    const s = Math.sin(Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD;
}

export function projection(view: View): GeoProjection {
    const { t, W, H } = view;
    // precision(0): no adaptive resampling. Coastline edges are short, so drawing them straight in
    // Mercator is indistinguishable, and resampling was a large share of each basemap redraw.
    return geoMercator()
        .scale(t.k * WORLD / (2 * Math.PI))
        .translate([t.x + t.k * WORLD / 2, t.y + t.k * WORLD / 2])
        .precision(0)
        .clipExtent([[-2, -2], [W + 2, H + 2]]);
}

export interface LonLatBox {
    w: number;
    e: number;
    n: number;
    s: number;
}

/**
 * Visible lon/lat box, from the zoom transform rather than projection.invert(): at full zoom-out the
 * left edge is exactly -180°, which invert() wraps to +180°, collapsing the box to the date line so
 * every continent but the date-line-crossing ones got culled (bug found in the HTML mockup).
 */
export function viewBounds(view: View): LonLatBox {
    const { t, W, H } = view;
    const lon = (x: number) => (x - t.x) / t.k / WORLD * 360 - 180;
    const lat = (y: number) => 360 / Math.PI * Math.atan(Math.exp(Math.PI * (1 - 2 * (y - t.y) / t.k / WORLD))) - 90;
    return { w: lon(0) - 1, e: lon(W) + 1, n: lat(0) + 1, s: lat(H) - 1 };
}

/** geoBounds box vs the view box; features crossing the antimeridian (west > east) are always drawn. */
export function intersects(b: [[number, number], [number, number]], v: LonLatBox): boolean {
    const [[w, s], [e, n]] = b;
    if (w > e) {
        return true;
    }
    return !(e < v.w || w > v.e || n < v.s || s > v.n);
}
