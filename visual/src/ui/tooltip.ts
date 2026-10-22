"use strict";

import powerbi from "powerbi-visuals-api";
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;

import { Route, ParsedData } from "../data";
import { Segment, FlowNode } from "../flows/model";
import { Chokepoint } from "../maritime/chokepoints";
import { SeaRoute, PASSAGE_NAMES, KM_PER_NM, KPLER_TO_TAG } from "../maritime/routing";

export interface TooltipContext {
    /** Maritime style: sea route per route id, and whether recorded transits are being followed. */
    sea: Map<number, SeaRoute>;
    followTransits: boolean;
    data: ParsedData;
    routes: Route[];
    format: (v: number) => string;
    volumeName: string;
    colorName: string | null;
    canalName: string | null;
    /** Total volume on the map, for the share line. */
    total: number;
    bundleFrom: "origin" | "destination";
    /** Terminal names shortened to the text before the first comma. */
    shortNames: boolean;
    /** Routes listed before "+N more". */
    maxRows: number;
    /** A route's flow color, for row bars and keys (destination terminals are pale rings). */
    colorOf: (r: Route) => string;
    /** Clicking pins the card (the click hint says so). */
    pinOnClick: boolean;
}

export interface TipRow {
    label: string;
    value: string;
    /** Share of the tooltip's total, 0..1, drawn as a small bar. */
    share?: number;
    color?: string;
    /** The route the row stands for, and the text a search in the pinned card matches. */
    routeId?: number;
    search?: string;
}

/** Everything a tooltip says, independent of how it is drawn (built-in card or Power BI tooltip). */
export interface TipModel {
    /** The headline number and what it is. */
    value: string;
    caption: string;
    title: string;
    color?: string;
    /** Secondary lines; the label names them in the Power BI tooltip. */
    subs: { label: string; text: string }[];
    facts: { label: string; value: string }[];
    rows: TipRow[];
    more?: TipRow;
    /** hint: "click to …" advice, which the pinned card drops. */
    notes: { text: string; warn?: boolean; hint?: boolean }[];
}

const pct = (x: number) => (x < 0.001 ? "<0.1%" : (100 * x).toFixed(1) + "%");

/** "Installation, Port, Country" → ["Installation", "Port, Country"]. */
function splitName(name: string): [string, string] {
    const i = name.indexOf(",");
    return i < 0 ? [name, ""] : [name.slice(0, i).trim(), name.slice(i + 1).trim()];
}

export function describeSegment(s: Segment, c: TooltipContext): TipModel {
    const name = (n: string) => (c.shortNames ? splitName(n)[0] : n);
    const routes = s.routeIds.map(id => c.routes[id]).sort((a, b) => b.volume - a.volume);
    const total = routes.reduce((sum, r) => sum + r.volume, 0);
    const share = c.total > 0 ? pct(total / c.total) + " of the volume on the map" : "";

    if (routes.length === 1) {
        const r = routes[0];
        const [, oPlace] = splitName(r.origin.name), [, dPlace] = splitName(r.destination.name);
        const m: TipModel = {
            value: c.format(r.volume), caption: c.volumeName, color: s.color,
            title: name(r.origin.name) + " → " + name(r.destination.name),
            subs: [], facts: [], rows: [], notes: []
        };
        if (c.shortNames && (oPlace || dPlace)) {
            m.subs.push({ label: "Location", text: (oPlace || name(r.origin.name)) + " → " + (dPlace || name(r.destination.name)) });
        }
        if (share) {
            m.subs.push({ label: "Share", text: share });
        }
        if (c.colorName && r.color !== null) {
            m.facts.push({ label: c.colorName, value: r.color || "(blank)" });
        }
        if (c.canalName && r.canal !== null) {
            m.facts.push({ label: c.canalName, value: r.canal || "None recorded" });
        }
        const sea = c.sea.get(r.id);
        if (sea) {
            const via = sea.via.map(t => PASSAGE_NAMES[t] || t);
            m.facts.push({ label: "Sea distance", value: "≈ " + Math.round(sea.km / KM_PER_NM).toLocaleString() + " nm" });
            if (via.length) {
                m.facts.push({ label: "Via", value: via.join(", ") });
            }
            if (!sea.matched && r.canal !== null && c.followTransits) {
                m.notes.push({ text: "Recorded transits could not be followed; the shortest route is shown.", warn: true });
            }
            else if (r.canal !== null && c.followTransits) {
                const tracked = new Set(Object.values(KPLER_TO_TAG));
                const added = sea.via.filter(t => tracked.has(t) && !sea.recorded.some(x => KPLER_TO_TAG[x] === t));
                if (added.length) {
                    m.notes.push({ text: "Also passes " + added.map(t => PASSAGE_NAMES[t] || t).join(", ") + ", which the record doesn't list." });
                }
            }
        }
        m.facts.push(...extraTooltips(r, c));
        if (sea) {
            m.notes.push({ text: "Indicative sea route, not a vessel track" });
        }
        m.notes.push(clickHint(c));
        return m;
    }

    let title: string, rowLabel: (r: Route) => string;
    if (s.kind) {
        title = (s.kind === "lane" ? "Sea lane" : "Port approach") + " · " + routes.length + " routes";
        rowLabel = r => name(r.origin.name) + " → " + name(r.destination.name);
    }
    else {
        const fromOrigin = c.bundleFrom === "origin";
        const src = fromOrigin ? routes[0].origin : routes[0].destination;
        title = (fromOrigin ? "From " : "To ") + name(src.name) + " · " + routes.length + (fromOrigin ? " destinations" : " origins");
        rowLabel = r => name(fromOrigin ? r.destination.name : r.origin.name);
    }
    const m: TipModel = {
        value: c.format(total), caption: c.volumeName + (s.kind ? " on this stretch" : " on this branch"), color: s.color, title,
        subs: share ? [{ label: "Share", text: share }] : [], facts: [], rows: [], notes: []
    };
    listRoutes(m, routes, total, rowLabel, c);
    if (s.kind) {
        m.notes.push({ text: "Indicative sea routes" });
    }
    m.notes.push(clickHint(c));
    return m;
}

export function describeNode(n: FlowNode, c: TooltipContext): TipModel {
    const [short, place] = splitName(n.place.t.name);
    const m: TipModel = {
        value: c.format(n.vol), caption: c.volumeName, color: n.fill,
        title: c.shortNames ? short : n.place.t.name,
        subs: c.shortNames && place ? [{ label: "Location", text: place }] : [], facts: [], rows: [], notes: []
    };
    if (n.out) {
        m.facts.push({ label: "Loaded", value: c.format(n.out) + " → " + n.outN + (n.outN === 1 ? " destination" : " destinations") });
    }
    if (n.in) {
        m.facts.push({ label: "Received", value: c.format(n.in) + " ← " + n.inN + (n.inN === 1 ? " origin" : " origins") });
    }
    const routes = n.routeIds.map(id => c.routes[id]).sort((a, b) => b.volume - a.volume);
    if (routes.length) {
        m.color = c.colorOf(routes[0]);
    }
    const name = (s: string) => (c.shortNames ? splitName(s)[0] : s);
    listRoutes(m, routes, n.vol, r => (r.origin.key === n.place.t.key ? "→ " + name(r.destination.name) : "← " + name(r.origin.name)), c);
    m.notes.push(clickHint(c));
    return m;
}

export function describeChokepoint(p: Chokepoint, c: TooltipContext, color: string): TipModel {
    const name = (n: string) => (c.shortNames ? splitName(n)[0] : n);
    const routes = p.routeIds.map(id => c.routes[id]).sort((a, b) => b.volume - a.volume);
    const m: TipModel = {
        value: p.basis === "none" ? "—" : c.format(p.volume), caption: c.volumeName, color, title: p.name,
        subs: c.total > 0 && p.volume > 0 ? [{ label: "Share", text: pct(p.volume / c.total) + " of the volume on the map" }] : [],
        facts: p.basis === "none" ? [] : [{ label: "Routes", value: routes.length.toLocaleString() }], rows: [], notes: []
    };
    listRoutes(m, routes, p.volume, r => name(r.origin.name) + " → " + name(r.destination.name), c);
    m.notes.push({
        text: p.basis === "recorded" ? "Routes whose recorded transits include it (" + (c.canalName || "canal transit") + ")"
            : p.basis === "drawn" ? "Routes drawn through it (no canal transit field bound)"
                : "Bind a canal transit field to see the volume through it"
    });
    if (routes.length) {
        m.notes.push(clickHint(c));
    }
    return m;
}

function clickHint(c: TooltipContext): { text: string; hint: boolean } {
    return { text: c.pinOnClick ? "Click to filter and pin these details" : "Click to filter", hint: true };
}

/** What tells apart two routes between the same terminals: the recorded transit, else the color category. */
function distinction(r: Route): string {
    if (r.canal !== null) {
        return /^\s*(no canal transit)?\s*$/i.test(r.canal) ? "no transit" : r.canal;
    }
    return r.color || "";
}

function listRoutes(m: TipModel, routes: Route[], total: number, label: (r: Route) => string, c: TooltipContext): void {
    const shown = routes.slice(0, Math.max(1, c.maxRows));
    const count = new Map<string, number>();
    for (const r of routes) {
        count.set(label(r), (count.get(label(r)) || 0) + 1);
    }
    for (const r of shown) {
        const base = label(r), extra = count.get(base) > 1 ? distinction(r) : "";
        m.rows.push({
            label: extra ? base + " · " + extra : base, value: c.format(r.volume), share: total > 0 ? r.volume / total : 0, color: c.colorOf(r),
            routeId: r.id, search: [r.origin.name, r.destination.name, r.canal || "", r.color || ""].join(" ").toLowerCase()
        });
    }
    if (routes.length > shown.length) {
        const rest = routes.slice(shown.length).reduce((s, r) => s + r.volume, 0);
        m.more = { label: "+" + (routes.length - shown.length) + " more", value: c.format(rest) };
    }
}

/** Values of the "Tooltips" measures (from the route's series). A route merging several rows shows their sum. */
function extraTooltips(r: Route, c: TooltipContext): { label: string; value: string }[] {
    const series = c.data.series[r.group];
    return (series ? series.tooltips : []).map(col => {
        const sum = r.rows.reduce((s, row) => s + (Number(col.values[row]) || 0), 0);
        const single = r.rows.length === 1 ? col.values[r.rows[0]] : null;
        return { label: col.source.displayName, value: single !== null && typeof single !== "number" ? String(single) : sum.toLocaleString() };
    });
}

/** The same content as Power BI tooltip rows (used when "Power BI tooltip" is chosen, incl. report page tooltips). */
export function toPowerBI(m: TipModel): VisualTooltipDataItem[] {
    const header = m.title;
    const items: VisualTooltipDataItem[] = [{ displayName: m.caption, value: m.value, color: m.color, header }];
    for (const s of m.subs) {
        items.push({ displayName: s.label, value: s.text, header });
    }
    for (const f of m.facts) {
        items.push({ displayName: f.label, value: f.value, header });
    }
    for (const r of m.rows) {
        items.push({ displayName: r.label, value: r.value + (r.share !== undefined ? "  (" + pct(r.share) + ")" : ""), header });
    }
    if (m.more) {
        items.push({ displayName: m.more.label, value: m.more.value, header });
    }
    for (const n of m.notes.filter(x => x.warn)) {
        items.push({ displayName: "Note", value: n.text, header });
    }
    return items;
}
