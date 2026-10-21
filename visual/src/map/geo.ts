"use strict";

import { feature, mesh } from "topojson-client";
import { geoArea, geoBounds, geoCentroid, geoMercator, geoPath, GeoPermissibleObjects } from "d3-geo";
import { Topology, GeometryCollection } from "topojson-specification";
import { Feature, MultiLineString, Polygon, MultiPolygon } from "geojson";

import world50 from "../geo/countries-50m.json";
import world10 from "../geo/countries-10m.json";
import usStates10 from "../geo/us-states-10m.json";
import { WORLD } from "./mercator";
import { NAME_FIX } from "./themes";

// Natural Earth via world-atlas 2.0.2 / us-atlas 3.0.1 (public domain data, ISC packaging).

export type Bounds = [[number, number], [number, number]];

export interface GeoSet {
    features: { f: Feature<Polygon | MultiPolygon>; b: Bounds }[];
    borders: MultiLineString;
}

export interface CountryLabel {
    name: string;
    lon: number;
    lat: number;
    /** Area of the largest polygon at k = 1, in base px², to decide when the name fits. */
    area: number;
}

/**
 * A few 1:10m Maldives rings are stored inverted, which d3 reads as "the whole globe except this
 * island" and paints every zoomed-in view as land. Reverse any polygon covering over half the globe.
 */
function rewindInverted(f: Feature<Polygon | MultiPolygon>): void {
    const g = f.geometry;
    const polys = g.type === "MultiPolygon" ? g.coordinates : [g.coordinates];
    for (const p of polys) {
        if (geoArea({ type: "Polygon", coordinates: p }) > 2 * Math.PI) {
            p.forEach(ring => ring.reverse());
        }
    }
}

function prep(topo: Topology): GeoSet {
    const obj = topo.objects.countries as GeometryCollection;
    const collection = feature(topo, obj) as unknown as { features: Feature<Polygon | MultiPolygon>[] };
    return {
        features: collection.features.map(f => {
            rewindInverted(f);
            return { f, b: geoBounds(f) as Bounds };
        }),
        borders: mesh(topo, obj, (a, b) => a !== b) as MultiLineString
    };
}

let low: GeoSet | null = null;
let high: GeoSet | null = null;
let states: MultiLineString | null = null;
let labels: CountryLabel[] | null = null;

export function geoLow(): GeoSet {
    return low || (low = prep(world50 as Topology));
}

/** The 1:10m set is only needed when zoomed in; prepare it lazily (it takes a moment). */
export function geoHigh(): GeoSet {
    return high || (high = prep(world10 as Topology));
}

export function geoHighReady(): boolean {
    return high !== null;
}

export function usStates(): MultiLineString {
    if (!states) {
        const topo = usStates10 as Topology;
        states = mesh(topo, topo.objects.states as GeometryCollection, (a, b) => a !== b) as MultiLineString;
    }
    return states;
}

export function countryLabels(): CountryLabel[] {
    if (labels) {
        return labels;
    }
    const area = geoPath(geoMercator().scale(WORLD / (2 * Math.PI)).translate([WORLD / 2, WORLD / 2])).area;
    labels = [];
    for (const { f } of geoLow().features) {
        const raw = f.properties && (f.properties.name as string);
        if (!raw || raw === "Antarctica") {
            continue;
        }
        const g = f.geometry;
        const polys: Polygon[] = g.type === "MultiPolygon" ? g.coordinates.map(c => ({ type: "Polygon", coordinates: c })) : [g];
        let best: Polygon = polys[0], bestArea = -1;
        for (const p of polys) {
            const a = area(p as GeoPermissibleObjects);
            if (a > bestArea) {
                bestArea = a;
                best = p;
            }
        }
        if (bestArea <= 0) {
            continue;
        }
        const [lon, lat] = geoCentroid(best);
        labels.push({ name: (NAME_FIX[raw] || raw).toUpperCase(), lon, lat, area: bestArea });
    }
    labels.sort((a, b) => b.area - a.area);
    return labels;
}
