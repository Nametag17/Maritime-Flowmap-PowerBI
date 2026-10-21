"use strict";

import marnet from "../geo/marnet.json";
import { Terminal } from "../data";

// Sea-lane network: Oak Ridge National Laboratory Global Shipping Lane Network, with Eurostat
// SeaRoute additions, as packaged by searoute-py (Apache-2.0).
//
// Routes are INDICATIVE: the shortest path over the network, forced through every chokepoint the
// data recorded ("Zone Canal Transit") and kept away from the tracked ones it did not record.
// They are not vessel tracks.

/** Kpler "Zone Canal Transit" names → passage tags in the network. */
export const KPLER_TO_TAG: Record<string, string> = {
    "Panama Canal": "panama",
    "Suez Canal": "suez",
    "Bab El Mandeb": "babalmandab",
    "Strait of Hormuz": "ormuz",
    "Cape of Good Hope": "south_africa"
};
const TRACKED = Object.values(KPLER_TO_TAG);
/** Never used by NGL trade; unblocked, USGC→Asia routes "shortcut" over Canada. */
const ARCTIC = ["northwest", "bering"];
/** Values meaning "no transit recorded" (the dashboard model turns blanks into "No Canal Transit"). */
const NONE_RECORDED = /^\s*(no canal transit|none|no transit|n\/a|-)?\s*$/i;

export const PASSAGE_NAMES: Record<string, string> = {
    panama: "Panama Canal", suez: "Suez Canal", babalmandab: "Bab El Mandeb", ormuz: "Strait of Hormuz",
    south_africa: "Cape of Good Hope", malacca: "Malacca Strait", gibraltar: "Gibraltar", sunda: "Sunda Strait",
    chili: "Strait of Magellan", bosporus: "Bosporus", dardanelles: "Dardanelles", bering: "Bering Strait",
    northwest: "Northwest Passage"
};

export const KM_PER_NM = 1.852;

export interface SeaRoute {
    km: number;
    /** Network node indices from the origin's lane node to the destination's. */
    nodes: number[];
    /** Passages the drawn route goes through. */
    via: string[];
    /** Transits recorded in the data (empty when none, or when the field isn't bound). */
    recorded: string[];
    /** True when the route honors the recorded transits; false when it fell back to the shortest path. */
    matched: boolean;
    /** Lane nodes the origin and destination snap to. */
    from: number;
    to: number;
}

export interface RouteOptions {
    /** Honor recorded transits (and avoid unrecorded tracked ones). */
    follow: boolean;
    blockArctic: boolean;
}

interface Edge { to: number; w: number; tag: string | null; }
interface Tree { dist: Float64Array; prev: Int32Array; }
interface Graph {
    lon: number[];
    lat: number[];
    adj: Edge[][];
    /** Per passage: its tagged nodes that also touch untagged lanes (where it is entered and left). */
    ends: Record<string, number[]>;
    /** Nodes with at least one untagged lane: where terminals may join the network. */
    open: number[];
}

let graph: Graph | null = null;
const trees = new Map<string, Tree>();
const snaps = new Map<string, number>();
const cache = new Map<string, SeaRoute | null>();

export function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
    const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371.0088 * Math.asin(Math.sqrt(s));
}

interface LaneFeature { properties: { passage?: string } | null; geometry: { type: string; coordinates: number[][] | number[][][] }; }

function seaGraph(): Graph {
    if (graph) {
        return graph;
    }
    const ids = new Map<string, number>(), lon: number[] = [], lat: number[] = [], adj: Edge[][] = [];
    const node = (c: number[]): number => {
        const x = c[0] === 180 ? -180 : c[0]; // lanes are split at the date line; ±180 is one meridian
        const k = x.toFixed(5) + "," + c[1].toFixed(5);
        let i = ids.get(k);
        if (i === undefined) {
            i = lon.length;
            ids.set(k, i);
            lon.push(x);
            lat.push(c[1]);
            adj.push([]);
        }
        return i;
    };
    for (const f of (marnet as { features: LaneFeature[] }).features) {
        const tag = (f.properties && f.properties.passage) || null;
        const lines = (f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][];
        for (const line of lines) {
            for (let i = 1; i < line.length; i++) {
                const a = node(line[i - 1]), b = node(line[i]);
                if (a === b) {
                    continue;
                }
                const w = haversineKm(lon[a], lat[a], lon[b], lat[b]);
                adj[a].push({ to: b, w, tag });
                adj[b].push({ to: a, w, tag });
            }
        }
    }
    const ends: Record<string, number[]> = {}, open: number[] = [];
    adj.forEach((edges, i) => {
        const untagged = edges.some(e => !e.tag);
        if (untagged) {
            open.push(i);
        }
        const tags = new Set(edges.filter(e => e.tag).map(e => e.tag));
        if (tags.size && untagged) {
            tags.forEach(t => (ends[t] = ends[t] || []).push(i));
        }
    });
    graph = { lon, lat, adj, ends, open };
    return graph;
}

export function laneNode(i: number): [number, number] {
    const g = seaGraph();
    return [g.lon[i], g.lat[i]];
}

/** The lane node a terminal joins the network at: the nearest one outside a passage. */
function snap(t: Terminal): number {
    let i = snaps.get(t.key);
    if (i === undefined) {
        const g = seaGraph();
        let best = -1, bestKm = Infinity;
        for (const pass of [20, 180]) { // look nearby first, then everywhere
            for (const n of g.open) {
                if (Math.abs(g.lat[n] - t.lat) > pass) {
                    continue;
                }
                const km = haversineKm(t.lon, t.lat, g.lon[n], g.lat[n]);
                if (km < bestKm) {
                    bestKm = km;
                    best = n;
                }
            }
            if (best >= 0) {
                break;
            }
        }
        snaps.set(t.key, i = best);
    }
    return i;
}

/** Shortest-path tree from one node over the lanes allow() accepts, memoized by key. */
function tree(src: number, key: string, allow: (e: Edge) => boolean): Tree {
    const memo = src + "|" + key;
    let t = trees.get(memo);
    if (t) {
        return t;
    }
    const g = seaGraph(), n = g.lon.length;
    const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
    const heapNode: number[] = [src], heapDist: number[] = [0];
    dist[src] = 0;
    const swap = (i: number, j: number) => {
        [heapNode[i], heapNode[j]] = [heapNode[j], heapNode[i]];
        [heapDist[i], heapDist[j]] = [heapDist[j], heapDist[i]];
    };
    while (heapNode.length) {
        const u = heapNode[0], du = heapDist[0];
        const lastN = heapNode.pop(), lastD = heapDist.pop();
        if (heapNode.length) {
            heapNode[0] = lastN;
            heapDist[0] = lastD;
            for (let i = 0; ;) {
                const l = 2 * i + 1, r = l + 1;
                let m = i;
                if (l < heapNode.length && heapDist[l] < heapDist[m]) m = l;
                if (r < heapNode.length && heapDist[r] < heapDist[m]) m = r;
                if (m === i) break;
                swap(i, m);
                i = m;
            }
        }
        if (du > dist[u]) {
            continue;
        }
        for (const e of g.adj[u]) {
            if (!allow(e)) {
                continue;
            }
            const nd = du + e.w;
            if (nd < dist[e.to]) {
                dist[e.to] = nd;
                prev[e.to] = u;
                heapNode.push(e.to);
                heapDist.push(nd);
                for (let i = heapNode.length - 1; i > 0;) {
                    const p = (i - 1) >> 1;
                    if (heapDist[p] <= heapDist[i]) break;
                    swap(i, p);
                    i = p;
                }
            }
        }
    }
    trees.set(memo, t = { dist, prev });
    return t;
}

const laneTree = (src: number, forbid: Set<string>) =>
    tree(src, "lanes:" + [...forbid].sort().join(","), e => !e.tag || !forbid.has(e.tag));
const passageTree = (src: number, tag: string) => tree(src, "pass:" + tag, e => e.tag === tag);

function nodesTo(t: Tree, target: number): number[] {
    const out: number[] = [];
    for (let u = target; u !== -1; u = t.prev[u]) {
        out.push(u);
    }
    return out.reverse();
}

function permutations<T>(list: T[]): T[][] {
    if (list.length <= 1) {
        return [list];
    }
    return list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map(p => [x, ...p]));
}

/** Cheapest s→t path that runs through every passage in `order`, in that order. */
function viaPassages(s: number, t: number, order: string[], forbid: Set<string>): { km: number; nodes: number[] } | null {
    const g = seaGraph();
    type State = { node: number; km: number; steps: [Tree, number][] };
    let states: State[] = [{ node: s, km: 0, steps: [] }];
    for (const tag of order) {
        const ends = g.ends[tag] || [];
        const bestAt = new Map<number, State>();
        for (const st of states) {
            const lanes = laneTree(st.node, forbid);
            for (const a of ends) {
                if (!isFinite(lanes.dist[a])) {
                    continue;
                }
                const through = passageTree(a, tag);
                for (const b of ends) {
                    if (b === a || !isFinite(through.dist[b])) {
                        continue;
                    }
                    const km = st.km + lanes.dist[a] + through.dist[b];
                    const cur = bestAt.get(b);
                    if (!cur || km < cur.km) {
                        bestAt.set(b, { node: b, km, steps: [...st.steps, [lanes, a], [through, b]] });
                    }
                }
            }
        }
        states = [...bestAt.values()];
        if (!states.length) {
            return null;
        }
    }
    let best: { km: number; steps: [Tree, number][] } | null = null;
    for (const st of states) {
        const lanes = laneTree(st.node, forbid);
        if (!isFinite(lanes.dist[t])) {
            continue;
        }
        const km = st.km + lanes.dist[t];
        if (!best || km < best.km) {
            best = { km, steps: [...st.steps, [lanes, t]] };
        }
    }
    if (!best) {
        return null;
    }
    const nodes = [s];
    for (const [tr, to] of best.steps) {
        nodes.push(...nodesTo(tr, to).slice(1));
    }
    return { km: best.km, nodes };
}

/**
 * Indicative sea route between two terminals. `canal` is the recorded transit list, "" or
 * "No Canal Transit" when none was recorded, or null when the field isn't bound (then only the
 * Arctic is avoided). Recorded transits that can't be honored sensibly (e.g. multi-leg voyages, or
 * more than 3× the free shortest path) fall back to the shortest route with matched = false.
 */
export function seaRoute(o: Terminal, d: Terminal, canal: string | null, opts: RouteOptions): SeaRoute | null {
    const key = o.key + ">" + d.key + ">" + (canal === null ? "\u0000" : canal) + ">" + opts.follow + opts.blockArctic;
    if (cache.has(key)) {
        return cache.get(key);
    }
    const g = seaGraph();
    const s = snap(o), t = snap(d);
    const recorded = canal === null || NONE_RECORDED.test(canal) ? [] : canal.split(",").map(x => x.trim()).filter(Boolean);
    const known = canal !== null && opts.follow;
    const required = known ? recorded.map(x => KPLER_TO_TAG[x]).filter(Boolean) : [];
    const always = new Set(opts.blockArctic ? ARCTIC : []);
    const forbid = new Set([...always, ...(known ? TRACKED : [])]);
    const free = laneTree(s, always);
    const freeKm = free.dist[t];

    let best: { km: number; nodes: number[] } | null = null;
    if (required.length) {
        for (const order of permutations(required)) {
            const c = viaPassages(s, t, order, forbid);
            if (c && (!best || c.km < best.km)) {
                best = c;
            }
        }
    }
    else {
        const lanes = laneTree(s, forbid);
        if (isFinite(lanes.dist[t])) {
            best = { km: lanes.dist[t], nodes: nodesTo(lanes, t) };
        }
    }
    let matched = known;
    if (!best || best.km > freeKm * 3) {
        best = isFinite(freeKm) ? { km: freeKm, nodes: nodesTo(free, t) } : null;
        matched = false;
    }
    let result: SeaRoute | null = null;
    if (best) {
        const via = new Set<string>();
        for (let i = 1; i < best.nodes.length; i++) {
            const e = g.adj[best.nodes[i - 1]].find(x => x.to === best.nodes[i]);
            if (e && e.tag) {
                via.add(e.tag);
            }
        }
        // Add the two port approaches (terminal ↔ lane node) to the sea distance.
        const approachKm = haversineKm(o.lon, o.lat, g.lon[s], g.lat[s]) + haversineKm(d.lon, d.lat, g.lon[t], g.lat[t]);
        result = { km: best.km + approachKm, nodes: best.nodes, via: [...via], recorded, matched, from: s, to: t };
    }
    cache.set(key, result);
    return result;
}
