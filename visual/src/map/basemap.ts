"use strict";

import { geoPath, GeoPermissibleObjects } from "d3-geo";

import { View, projection, viewBounds, intersects } from "./mercator";
import { geoLow, geoHigh, geoHighReady, usStates, countryLabels } from "./geo";
import { MapTheme, SEAS } from "./themes";
import { Box, overlaps, textWidth } from "../util";

/** From k = 24 (≈ Bing zoom 4.6) the 1:10m coastlines replace the 1:50m ones. */
const HI_RES_FROM_K = 24;
const FONT = "\"Segoe UI\", wf_segoe-ui_normal, helvetica, arial, sans-serif";

export interface BasemapOptions {
    countryLabels: boolean;
    seaLabels: boolean;
    usStates: boolean;
    /** While panning/zooming, stay on the 1:50m data for speed. */
    interacting: boolean;
}

/** Draws ocean, land, coastlines, borders and map labels on the canvas. No tiles, no network. */
export function drawBasemap(canvas: HTMLCanvasElement, dpr: number, view: View, theme: MapTheme, opts: BasemapOptions, obstacles: Box[]): void {
    const ctx = canvas.getContext("2d");
    const { W, H, t } = view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.ocean;
    ctx.fillRect(0, 0, W, H);

    const proj = projection(view), path = geoPath(proj, ctx), vb = viewBounds(view);
    const geo = !opts.interacting && t.k >= HI_RES_FROM_K ? geoHigh() : geoLow();

    ctx.beginPath();
    for (const { f, b } of geo.features) {
        if (intersects(b, vb)) {
            path(f as GeoPermissibleObjects);
        }
    }
    ctx.fillStyle = theme.land;
    ctx.fill();
    ctx.lineJoin = "round";
    ctx.lineWidth = 0.75;
    ctx.strokeStyle = theme.coast;
    ctx.stroke();

    ctx.beginPath();
    path(geo.borders);
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = theme.border;
    ctx.stroke();

    if (opts.usStates && t.k >= 6) {
        ctx.beginPath();
        path(usStates());
        ctx.lineWidth = 0.5;
        ctx.strokeStyle = theme.state;
        ctx.stroke();
    }

    drawMapLabels(ctx, view, theme, opts, obstacles);
}

/** True once the 1:10m data is needed but not prepared yet (prepare it when idle). */
export function needsHighRes(view: View): boolean {
    return view.t.k >= HI_RES_FROM_K && !geoHighReady();
}

function drawMapLabels(ctx: CanvasRenderingContext2D, view: View, theme: MapTheme, opts: BasemapOptions, obstacles: Box[]): void {
    const { W, H, t } = view;
    const proj = projection(view);
    const boxes = obstacles.slice();
    const spaced = "letterSpacing" in ctx;
    const setSpacing = (v: string) => {
        if (spaced) {
            (ctx as unknown as { letterSpacing: string }).letterSpacing = v;
        }
    };
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (opts.seaLabels) {
        const font = "italic 11px " + FONT;
        ctx.font = font;
        ctx.fillStyle = theme.seaLabel;
        setSpacing("0.5px");
        for (const s of SEAS) {
            if (t.k < s.minK || (s.maxK && t.k > s.maxK)) {
                continue;
            }
            const [x, y] = proj([s.lon, s.lat]);
            const w = textWidth(s.name, font) + 6;
            const box = { x0: x - w / 2, y0: y - 8, x1: x + w / 2, y1: y + 8 };
            if (box.x0 < 0 || box.x1 > W || box.y0 < 0 || box.y1 > H || overlaps(box, boxes)) {
                continue;
            }
            ctx.fillText(s.name, x, y);
            boxes.push(box);
        }
    }

    if (opts.countryLabels) {
        const font = "600 10px " + FONT;
        ctx.font = font;
        ctx.fillStyle = theme.countryLabel;
        setSpacing("1px");
        for (const c of countryLabels()) {
            const w = textWidth(c.name, font) + c.name.length + 6;
            if (c.area * t.k * t.k < w * 30) {
                continue; // only label shapes the name roughly fits in
            }
            const [x, y] = proj([c.lon, c.lat]);
            const box = { x0: x - w / 2, y0: y - 8, x1: x + w / 2, y1: y + 8 };
            if (box.x0 < 0 || box.x1 > W || box.y0 < 0 || box.y1 > H || overlaps(box, boxes)) {
                continue;
            }
            ctx.fillText(c.name, x, y);
            boxes.push(box);
        }
    }
    setSpacing("0px");
}
