"use strict";

export interface Box {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

export function overlaps(a: Box, boxes: Box[]): boolean {
    return boxes.some(b => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0);
}

const measureCtx = document.createElement("canvas").getContext("2d");
const widthCache = new Map<string, number>();

/** Text width in px for a CSS font string, cached. */
export function textWidth(text: string, font: string): number {
    const key = font + "|" + text;
    let w = widthCache.get(key);
    if (w === undefined) {
        measureCtx.font = font;
        w = measureCtx.measureText(text).width;
        widthCache.set(key, w);
    }
    return w;
}

/** Element bounds relative to a container, padded, for label collision. */
export function boxOf(el: Element, container: Element, pad = 2): Box {
    const r = el.getBoundingClientRect(), c = container.getBoundingClientRect();
    return { x0: r.left - c.left - pad, y0: r.top - c.top - pad, x1: r.right - c.left + pad, y1: r.bottom - c.top + pad };
}
