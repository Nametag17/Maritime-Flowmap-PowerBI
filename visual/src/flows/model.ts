"use strict";

import { scaleLinear, scalePow, scaleSqrt } from "d3-scale";

import { layout, IPath } from "../engine/algo";
import { arc } from "../engine/arc";
import { baseX, baseY, LEVEL20 } from "../map/mercator";
import { Route, Terminal } from "../data";
import { buildLanes } from "../maritime/lanes";
import { SeaRoute } from "../maritime/routing";

export type FlowStyle = "bundled" | "arc" | "curved" | "straight" | "maritime";

export interface ModelOptions {
    style: FlowStyle;
    bundleFrom: "origin" | "destination";
    /** Bundled style only: keep the N heaviest bundles (0 = all), like the original's "limit". */
    flowLimit: number;
    minWidth: number;
    maxWidth: number;
    widthScale: "linear" | "compressed";
    terminals: "bubbles" | "dots" | "off";
    bubbleMax: number;
    colorOf: (r: Route) => string;
    colorKey: (r: Route) => string;
    destinationColor: string;
    /** Maritime style: honor recorded transits, avoid Arctic passages, draw port approaches. */
    maritime: { follow: boolean; blockArctic: boolean; approaches: boolean };
}

/** A terminal with its base Web Mercator position (k = 1). */
export interface Place {
    t: Terminal;
    bx: number;
    by: number;
}

export interface Segment {
    id: string;
    routeIds: number[];
    color: string;
    weight: number;
    width: number;
    /** Bundled: the engine path and the tree's source. */
    path?: IPath;
    source?: Place;
    /** Arc / curved / straight: the single route, and (arc, maritime) a base-coordinate polyline. */
    route?: Route;
    pts?: [number, number][];
    /** Maritime: a stretch of sea lane shared by routeIds, or a terminal's port approach. */
    kind?: "lane" | "approach";
}

export interface FlowNode {
    place: Place;
    out: number;
    in: number;
    outN: number;
    inN: number;
    vol: number;
    routeIds: number[];
    role: "origin" | "destination";
    fill: string;
    r: number;
}

export interface FlowModel {
    style: FlowStyle;
    bundleFrom: "origin" | "destination";
    segments: Segment[];
    nodes: FlowNode[];
    places: Map<string, Place>;
    scale: (v: number) => number;
    dmin: number;
    dmax: number;
    /** Routes left out by the bundle limit. */
    limited: number;
    /** Maritime: the sea route of each route id, and how many routes found no sea path. */
    sea: Map<number, SeaRoute>;
    unrouted: number;
}

function widthScale(dmin: number, dmax: number, o: ModelOptions): (v: number) => number {
    const min = o.minWidth, max = o.maxWidth;
    if (!(dmax > 0)) {
        return () => min;
    }
    if (o.widthScale === "compressed") {
        // Same rule as the original "log" option: raise the exponent until the smallest flow is no
        // wider than the minimum.
        let exp = 0.5;
        const pow = scalePow().exponent(exp).domain([0, dmax]).range([0, max]);
        while (pow(dmin) > min && exp < 1.1) {
            pow.exponent(exp += 0.1);
        }
        if (pow(dmin) > min) {
            return v => pow(v);
        }
        const lin = scaleLinear().domain([pow(dmin), max]).range([min, max]);
        return v => lin(pow(v));
    }
    const lin = scaleLinear().domain([0, dmax]).range([0, max]);
    if (lin(dmin) < min) {
        lin.domain([dmin, dmax]).range([min, max]);
    }
    return v => lin(v);
}

export function buildModel(routes: Route[], o: ModelOptions): FlowModel {
    const places = new Map<string, Place>();
    const place = (t: Terminal): Place => {
        let p = places.get(t.key);
        if (!p) {
            places.set(t.key, p = { t, bx: baseX(t.lon), by: baseY(t.lat) });
        }
        return p;
    };
    const segments: Segment[] = [];
    let shown = routes, limited = 0, unrouted = 0, sea = new Map<number, SeaRoute>();

    if (o.style === "bundled") {
        const fromOrigin = o.bundleFrom === "origin";
        const groups = new Map<string, Route[]>();
        for (const r of routes) {
            const k = (fromOrigin ? r.origin.key : r.destination.key) + "|" + o.colorKey(r);
            (groups.get(k) || groups.set(k, []).get(k)).push(r);
        }
        let groupList = [...groups.values()];
        if (o.flowLimit > 0 && groupList.length > o.flowLimit) {
            const total = (g: Route[]) => g.reduce((s, r) => s + r.volume, 0);
            groupList.sort((a, b) => total(b) - total(a));
            limited = groupList.slice(o.flowLimit).reduce((s, g) => s + g.length, 0);
            groupList = groupList.slice(0, o.flowLimit);
            shown = [].concat(...groupList);
        }
        for (const group of groupList) {
            const src = place(fromOrigin ? group[0].origin : group[0].destination);
            // Merge targets that share a spot: the original layout loops forever on coincident points.
            const spots = new Map<string, { x: number; y: number; routes: Route[]; vol: number }>();
            for (const r of group) {
                const t = place(fromOrigin ? r.destination : r.origin);
                const x = Math.round((t.bx - src.bx) * LEVEL20), y = Math.round((t.by - src.by) * LEVEL20);
                if (Math.abs(x) < 8 && Math.abs(y) < 8) {
                    continue; // self-link: nothing to draw
                }
                const k = Math.round(x / 8) + "," + Math.round(y / 8);
                let spot = spots.get(k);
                if (!spot) {
                    spots.set(k, spot = { x, y, routes: [], vol: 0 });
                }
                spot.routes.push(r);
                spot.vol += r.volume;
            }
            const targets = [...spots.values()];
            if (!targets.length) {
                continue;
            }
            const tree = layout({ x: 0, y: 0, key: "src" }, targets.map((t, i) => ({ x: t.x, y: t.y, key: i })), targets.map(t => t.vol));
            const color = o.colorOf(group[0]);
            for (const path of tree.build(i => targets[i as number].vol)) {
                segments.push({
                    id: "tree:" + src.t.key + "|" + o.colorKey(group[0]) + "|" + path.id,
                    routeIds: [].concat(...path.leafs.map(i => targets[i as number].routes.map(r => r.id))),
                    color, weight: path.weight, width: 0, path, source: src
                });
            }
        }
    }
    else if (o.style === "maritime") {
        const lanes = buildLanes(routes, o.colorOf, o.colorKey, o.maritime);
        sea = lanes.info;
        unrouted = lanes.unrouted;
        for (const s of lanes.segments) {
            segments.push({ id: s.id, routeIds: s.routeIds, color: s.color, weight: s.weight, width: 0, pts: s.pts, kind: s.kind });
        }
    }
    else {
        for (const r of routes) {
            const a = place(r.origin), b = place(r.destination);
            if (a.bx === b.bx && a.by === b.by) {
                continue;
            }
            segments.push({
                id: "route:" + r.id, routeIds: [r.id], color: o.colorOf(r), weight: r.volume, width: 0, route: r,
                pts: o.style === "arc" ? arcPoints(r) : undefined
            });
        }
    }

    const weights = segments.filter(s => s.kind !== "approach").map(s => s.weight);
    const dmin = weights.length ? Math.min(...weights) : 0, dmax = weights.length ? Math.max(...weights) : 0;
    const scale = widthScale(dmin, dmax, o);
    for (const s of segments) {
        // For tree paths the engine also sets the screen-space offset that peels a branch off the
        // edge of its parent trunk. Port approaches are thin dashes whatever the volume.
        s.width = s.kind === "approach" ? 1.4 : s.path ? s.path.width(scale) : scale(s.weight);
    }
    segments.sort((a, b) => b.width - a.width);

    return {
        style: o.style, bundleFrom: o.bundleFrom, segments, nodes: buildNodes(shown, place, o), places, scale, dmin, dmax, limited,
        sea, unrouted
    };
}

/** Great circle from the original engine (arc.js port), in longitudes relative to the origin. */
function arcPoints(r: Route): [number, number][] {
    let dx = r.destination.lon - r.origin.lon;
    if (dx > 180) dx -= 360;
    if (dx < -180) dx += 360;
    const cnt = Math.max(Math.round(Math.abs(dx / 4)), 10);
    return arc({ x: 0, y: r.origin.lat }, { x: dx, y: r.destination.lat }, cnt)
        .map(([x, y]) => [baseX(r.origin.lon + x), baseY(y)] as [number, number]);
}

function buildNodes(routes: Route[], place: (t: Terminal) => Place, o: ModelOptions): FlowNode[] {
    const nodes = new Map<string, FlowNode & { topOut: number }>();
    const node = (t: Terminal) => {
        let n = nodes.get(t.key);
        if (!n) {
            nodes.set(t.key, n = {
                place: place(t), out: 0, in: 0, outN: 0, inN: 0, vol: 0, routeIds: [],
                role: "destination", fill: o.destinationColor, r: 0, topOut: 0
            });
        }
        return n;
    };
    for (const r of routes) {
        const a = node(r.origin), b = node(r.destination);
        a.out += r.volume; a.outN++; a.routeIds.push(r.id);
        b.in += r.volume; b.inN++; b.routeIds.push(r.id);
        if (r.volume >= a.topOut) {
            a.topOut = r.volume;
            a.fill = o.colorOf(r);
        }
    }
    const list = [...nodes.values()];
    const maxVol = Math.max(1, ...list.map(n => n.out + n.in));
    const radius = scaleSqrt().domain([0, maxVol]).range([0, o.bubbleMax]);
    for (const n of list) {
        n.vol = n.out + n.in;
        n.role = n.out > 0 ? "origin" : "destination";
        if (n.role === "destination") {
            n.fill = o.destinationColor;
        }
        n.r = o.terminals === "bubbles" ? Math.max(3.5, radius(n.vol)) : n.role === "origin" ? 4.5 : 3.5;
    }
    return list.sort((a, b) => b.vol - a.vol);
}
