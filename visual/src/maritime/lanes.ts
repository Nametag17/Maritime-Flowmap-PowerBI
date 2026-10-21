"use strict";

import { Route, Terminal } from "../data";
import { baseX, baseY } from "../map/mercator";
import { seaRoute, laneNode, SeaRoute, RouteOptions } from "./routing";

export interface LaneSegment {
    id: string;
    kind: "lane" | "approach";
    routeIds: number[];
    color: string;
    /** Summed volume of the routes on this stretch (0 for port approaches, which have a fixed width). */
    weight: number;
    /** Base-coordinate polyline, unwrapped across the date line (x may leave [0, WORLD]). */
    pts: [number, number][];
}

export interface LaneResult {
    segments: LaneSegment[];
    /** Sea route per route id, for tooltips. */
    info: Map<number, SeaRoute>;
    unrouted: number;
}

/** Lon/lat → base coords, unwrapping longitudes so a lane stays continuous across ±180°. */
function unwrap(points: [number, number][]): [number, number][] {
    const out: [number, number][] = [];
    let prev: number | null = null;
    for (const [lon, lat] of points) {
        let x = lon;
        if (prev !== null) {
            while (x - prev > 180) x -= 360;
            while (x - prev < -180) x += 360;
        }
        out.push([baseX(x), baseY(lat)]);
        prev = x;
    }
    return out;
}

/**
 * Routes every flow over the sea lanes and merges stretches carried by the same set of routes into
 * one segment, so volumes add up where routes share a lane (the maritime counterpart of bundling).
 */
export function buildLanes(routes: Route[], colorOf: (r: Route) => string, colorKey: (r: Route) => string, opts: RouteOptions & { approaches: boolean }): LaneResult {
    const info = new Map<number, SeaRoute>();
    const edges = new Map<string, { a: number; b: number; ck: string; ids: number[]; vol: number; color: string }>();
    const approaches = new Map<string, { t: Terminal; n: number; ids: number[]; color: string }>();
    let unrouted = 0;

    for (const r of routes) {
        const sr = seaRoute(r.origin, r.destination, r.canal, opts);
        if (!sr) {
            unrouted++;
            continue;
        }
        info.set(r.id, sr);
        const ck = colorKey(r), color = colorOf(r);
        for (let i = 1; i < sr.nodes.length; i++) {
            const a = Math.min(sr.nodes[i - 1], sr.nodes[i]), b = Math.max(sr.nodes[i - 1], sr.nodes[i]);
            const k = ck + "|" + a + "-" + b;
            let e = edges.get(k);
            if (!e) {
                edges.set(k, e = { a, b, ck, ids: [], vol: 0, color });
            }
            e.ids.push(r.id);
            e.vol += r.volume;
        }
        if (opts.approaches) {
            for (const [t, n] of [[r.origin, sr.from], [r.destination, sr.to]] as [Terminal, number][]) {
                const k = ck + "|" + t.key;
                let ap = approaches.get(k);
                if (!ap) {
                    approaches.set(k, ap = { t, n, ids: [], color });
                }
                ap.ids.push(r.id);
            }
        }
    }

    // Chain edges with identical route sets into polylines, breaking at junctions.
    const groups = new Map<string, { a: number; b: number; ids: number[]; vol: number; color: string }[]>();
    for (const e of edges.values()) {
        const sig = e.ck + "|" + e.ids.slice().sort((x, y) => x - y).join(",");
        (groups.get(sig) || groups.set(sig, []).get(sig)).push(e);
    }
    const segments: LaneSegment[] = [];
    for (const [sig, list] of groups) {
        const byNode = new Map<number, typeof list>();
        for (const e of list) {
            for (const n of [e.a, e.b]) {
                (byNode.get(n) || byNode.set(n, []).get(n)).push(e);
            }
        }
        const used = new Set<object>();
        const walk = (start: number): number[] => {
            const nodes = [start];
            let cur = start;
            for (;;) {
                const next = byNode.get(cur).find(e => !used.has(e));
                if (!next) break;
                used.add(next);
                cur = next.a === cur ? next.b : next.a;
                nodes.push(cur);
                if (byNode.get(cur).length !== 2) break;
            }
            return nodes;
        };
        const starts = [...byNode.keys()].filter(n => byNode.get(n).length !== 2);
        for (const n of starts.concat([...byNode.keys()])) {
            while (byNode.get(n).some(e => !used.has(e))) {
                const nodes = walk(n);
                if (nodes.length < 2) break;
                segments.push({
                    id: "lane:" + sig + ":" + segments.length, kind: "lane", routeIds: list[0].ids.slice(),
                    color: list[0].color, weight: list[0].vol, pts: unwrap(nodes.map(laneNode))
                });
            }
        }
    }
    for (const ap of approaches.values()) {
        segments.push({
            id: "approach:" + ap.t.key + ":" + ap.color, kind: "approach", routeIds: ap.ids, color: ap.color, weight: 0,
            pts: unwrap([[ap.t.lon, ap.t.lat], laneNode(ap.n)])
        });
    }
    return { segments, info, unrouted };
}
