"use strict";

import { Route } from "../data";
import { baseX, baseY } from "../map/mercator";
import { KPLER_TO_TAG, SeaRoute } from "./routing";

/** The chokepoints Kpler tracks in "Zone Canal Transit", placed on the passage itself. */
export const CHOKEPOINTS: { tag: string; name: string; canal: boolean; lat: number; lon: number }[] = [
    { tag: "panama", name: "Panama Canal", canal: true, lat: 9.08, lon: -79.68 },
    { tag: "suez", name: "Suez Canal", canal: true, lat: 30.58, lon: 32.33 },
    { tag: "babalmandab", name: "Bab El Mandeb", canal: false, lat: 12.58, lon: 43.33 },
    { tag: "ormuz", name: "Strait of Hormuz", canal: false, lat: 26.57, lon: 56.25 },
    { tag: "south_africa", name: "Cape of Good Hope", canal: false, lat: -34.36, lon: 18.47 }
];

export type ChokepointSet = "all" | "canals" | "panama";

export interface Chokepoint {
    tag: string;
    name: string;
    /** Base Web Mercator position (k = 1). */
    bx: number;
    by: number;
    volume: number;
    routeIds: number[];
    /** Where the volume comes from: the recorded transits, the drawn sea routes, or nowhere. */
    basis: "recorded" | "drawn" | "none";
}

/**
 * Volume through each chokepoint. With the canal transit field bound it counts the recorded
 * transits, the same rule as a chokepoint filter (a route counts under every chokepoint it passed),
 * so the map agrees with the report's filters. Without it, the Maritime style's drawn sea routes are
 * used; other styles have nothing to count, so the markers only show where the chokepoints are.
 */
export function chokepoints(routes: Route[], sea: Map<number, SeaRoute>, set: ChokepointSet, onlyActive: boolean): Chokepoint[] {
    const basis: Chokepoint["basis"] = routes.some(r => r.canal !== null) ? "recorded" : sea.size ? "drawn" : "none";
    const tagsOf = (r: Route): string[] => basis === "recorded"
        ? (r.canal || "").split(",").map(x => KPLER_TO_TAG[x.trim()]).filter(Boolean)
        : basis === "drawn" && sea.has(r.id) ? sea.get(r.id).via : [];
    const list: Chokepoint[] = CHOKEPOINTS
        .filter(c => set === "all" || (set === "canals" ? c.canal : c.tag === "panama"))
        .map(c => ({ tag: c.tag, name: c.name, bx: baseX(c.lon), by: baseY(c.lat), volume: 0, routeIds: [], basis }));
    const byTag = new Map(list.map(c => [c.tag, c]));
    for (const r of routes) {
        for (const tag of new Set(tagsOf(r))) {
            const c = byTag.get(tag);
            if (c) {
                c.volume += r.volume;
                c.routeIds.push(r.id);
            }
        }
    }
    return basis !== "none" && onlyActive ? list.filter(c => c.routeIds.length) : list;
}
