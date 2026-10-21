"use strict";

import powerbi from "powerbi-visuals-api";
import DataView = powerbi.DataView;
import DataViewCategoryColumn = powerbi.DataViewCategoryColumn;
import DataViewValueColumn = powerbi.DataViewValueColumn;
import DataViewValueColumns = powerbi.DataViewValueColumns;
import DataViewValueColumnGroup = powerbi.DataViewValueColumnGroup;
import PrimitiveValue = powerbi.PrimitiveValue;

export interface Terminal {
    key: string;
    name: string;
    lat: number;
    lon: number;
}

export interface Route {
    id: number;
    origin: Terminal;
    destination: Terminal;
    volume: number;
    /** "Color by" category (the series name), or null when the field isn't bound. */
    color: string | null;
    /** Index into ParsedData.groups: the series this route's volume came from. */
    group: number;
    /** Recorded canal/strait transits ("" = none recorded), or null when the field isn't bound. */
    canal: string | null;
    /** Indices of the data view rows aggregated into this route (for selection and tooltips). */
    rows: number[];
}

/** One series of measures; there is one per "Color by" value, or a single unnamed one. */
export interface Series {
    name: string | null;
    group: DataViewValueColumnGroup;
    volume: DataViewValueColumn | null;
    tooltips: DataViewValueColumn[];
}

export interface ParsedData {
    routes: Route[];
    terminals: Map<string, Terminal>;
    /** Rows that could not be placed on the map, with their volume. */
    unplaced: { rows: number; volume: number; reasons: Map<string, number> };
    /** Names of the required wells that are still empty. */
    missing: string[];
    /** The origin column; its identities identify rows for selection. */
    rowColumn: DataViewCategoryColumn | null;
    values: DataViewValueColumns | null;
    series: Series[];
    /** Format string of the Volume measure (for the dashboard's bbls / Mbbls / MBPD switch). */
    volumeFormat: string | undefined;
    colorBound: boolean;
    /** Display names of the bound fields, for tooltips and the legend. */
    names: { volume: string; color: string | null; canal: string | null };
}

function categoryFor(dataView: DataView, role: string): DataViewCategoryColumn | null {
    const categories = dataView?.categorical?.categories || [];
    return categories.find(c => c.source.roles && c.source.roles[role]) || null;
}

/** A number, or text holding one (the dashboard model stores Geocode.latitude as text). */
export function parseNumber(value: PrimitiveValue): number | null {
    if (typeof value === "number") {
        return isFinite(value) ? value : null;
    }
    if (typeof value === "string" && value.trim() !== "") {
        const n = Number(value.trim());
        return isFinite(n) ? n : null;
    }
    return null;
}

function validLatLon(lat: number, lon: number): boolean {
    return Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function readSeries(values: DataViewValueColumns | null, colorBound: boolean): Series[] {
    if (!values) {
        return [];
    }
    return values.grouped().map(group => ({
        name: colorBound ? (group.name === null || group.name === undefined ? "(blank)" : String(group.name)) : null,
        group,
        volume: group.values.find(v => v.source.roles && v.source.roles.volume) || null,
        tooltips: group.values.filter(v => v.source.roles && v.source.roles.tooltips)
    }));
}

/**
 * Reads the categorical data view into routes between terminals, using the latitude and longitude
 * wells of each end. Nothing is geocoded: a row without usable coordinates is counted as unplaced.
 * "Color by" groups the measures into series, so a route is one (origin, destination, canal, series).
 */
export function parseDataView(dataView: DataView): ParsedData {
    const origin = categoryFor(dataView, "origin");
    const destination = categoryFor(dataView, "destination");
    const oLat = categoryFor(dataView, "originLat"), oLon = categoryFor(dataView, "originLon");
    const dLat = categoryFor(dataView, "destLat"), dLon = categoryFor(dataView, "destLon");
    const canalCol = categoryFor(dataView, "canal");
    const values = dataView?.categorical?.values || null;
    const colorBound = !!(values && values.source && values.source.roles && values.source.roles.color);
    const series = readSeries(values, colorBound);
    const volumeColumn = series.length ? series[0].volume : null;

    const missing: string[] = [];
    if (!origin) missing.push("Origin");
    if (!oLat) missing.push("Origin latitude");
    if (!oLon) missing.push("Origin longitude");
    if (!destination) missing.push("Destination");
    if (!dLat) missing.push("Destination latitude");
    if (!dLon) missing.push("Destination longitude");

    const result: ParsedData = {
        routes: [], terminals: new Map(), unplaced: { rows: 0, volume: 0, reasons: new Map() }, missing,
        rowColumn: origin, values, series, volumeFormat: volumeColumn ? volumeColumn.source.format : undefined, colorBound,
        names: {
            volume: volumeColumn ? volumeColumn.source.displayName : "Routes",
            color: colorBound && values.source ? values.source.displayName : null,
            canal: canalCol ? canalCol.source.displayName : null
        }
    };
    if (missing.length) {
        return result;
    }

    const coordsAt = (row: number, lat: DataViewCategoryColumn, lon: DataViewCategoryColumn): [number, number] | null => {
        const a = parseNumber(lat.values[row]), b = parseNumber(lon.values[row]);
        return a === null || b === null ? null : [a, b];
    };
    const terminal = (name: PrimitiveValue, ll: [number, number]): Terminal => {
        const label = name === null || name === undefined || name === "" ? "(blank)" : String(name);
        const key = label + "@" + ll[0].toFixed(5) + "," + ll[1].toFixed(5);
        let t = result.terminals.get(key);
        if (!t) {
            t = { key, name: label, lat: ll[0], lon: ll[1] };
            result.terminals.set(key, t);
        }
        return t;
    };
    const unplace = (reason: string, volume: number) => {
        result.unplaced.rows++;
        result.unplaced.volume += volume;
        result.unplaced.reasons.set(reason, (result.unplaced.reasons.get(reason) || 0) + 1);
    };
    // Without a Volume measure every row counts once, in a single series.
    const seriesList = series.length && series.some(s => s.volume) ? series : [null];

    const byKey = new Map<string, Route>();
    for (let row = 0; row < origin.values.length; row++) {
        const rowVolume = seriesList.reduce((s, sr) => s + (sr && sr.volume ? parseNumber(sr.volume.values[row]) ?? 0 : 1), 0);
        const o = coordsAt(row, oLat, oLon), d = coordsAt(row, dLat, dLon);
        if (!o || !d) {
            unplace(!o && !d ? "no coordinates at either end" : !o ? "no origin coordinates" : "no destination coordinates", rowVolume);
            continue;
        }
        if (!validLatLon(o[0], o[1]) || !validLatLon(d[0], d[1])) {
            unplace("coordinates out of range (latitude and longitude swapped?)", rowVolume);
            continue;
        }
        const ot = terminal(origin.values[row], o), dt = terminal(destination.values[row], d);
        const canal = canalCol ? String(canalCol.values[row] ?? "") : null;
        seriesList.forEach((sr, g) => {
            const raw = sr && sr.volume ? sr.volume.values[row] : 1;
            if (raw === null || raw === undefined) {
                return; // this row has no value in this series (e.g. another product)
            }
            const volume = parseNumber(raw) ?? 0;
            const color = sr ? sr.name : null;
            const key = ot.key + ">" + dt.key + ">" + g + ">" + (canal ?? "");
            let route = byKey.get(key);
            if (!route) {
                route = { id: result.routes.length, origin: ot, destination: dt, volume: 0, color, group: g, canal, rows: [] };
                byKey.set(key, route);
                result.routes.push(route);
            }
            route.volume += volume;
            route.rows.push(row);
        });
    }
    return result;
}
