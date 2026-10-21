"use strict";

import { FlowModel } from "../flows/model";
import { MapTheme } from "../map/themes";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface LegendArgs {
    show: boolean;
    position: "topLeft" | "bottomLeft";
    fontSize: number;
    theme: MapTheme;
    model: FlowModel;
    format: (v: number) => string;
    colorTitle: string;
    colorEntries: { label: string; color: string }[];
    terminals: "bubbles" | "dots" | "off";
    originColor: string;
    destinationColor: string;
    unplaced: { rows: number; volume: number };
    collapsed: boolean;
    onToggle: () => void;
}

function div(cls: string, text?: string): HTMLDivElement {
    const d = document.createElement("div");
    d.className = cls;
    if (text !== undefined) {
        d.textContent = text; // labels are data: never innerHTML
    }
    return d;
}

/** A few round values spanning the width scale, e.g. 10M / 3M / 700k. */
function sampleValues(dmin: number, dmax: number): number[] {
    if (!(dmax > 0)) {
        return [];
    }
    const roundDown = (v: number) => {
        const p = 10 ** Math.floor(Math.log10(v));
        return Math.floor(v / p) * p;
    };
    const values = [dmax, dmax / 3, Math.max(dmin, dmax / 15)].map(roundDown).filter(v => v >= dmin * 0.999 && v > 0);
    return [...new Set(values.length ? values : [dmax])];
}

export function renderLegend(container: HTMLDivElement, a: LegendArgs): void {
    container.replaceChildren();
    container.style.display = a.show ? "" : "none";
    if (!a.show) {
        return;
    }
    container.className = "wfm-legend wfm-legend-" + a.position + (a.collapsed ? " wfm-collapsed" : "");
    container.style.fontSize = a.fontSize + "px";
    container.style.background = a.theme.panel;
    container.style.borderColor = a.theme.panelBorder;
    container.style.color = a.theme.text;

    const toggle = document.createElement("button");
    toggle.className = "wfm-legend-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(!a.collapsed));
    toggle.append(div("", "Legend"), div("", a.collapsed ? "▸" : "▾"));
    toggle.addEventListener("click", e => {
        e.stopPropagation();
        a.onToggle();
    });
    const body = div("wfm-legend-body");
    container.append(toggle, body);

    const widths = div("");
    widths.append(div("wfm-legend-title", a.model.style === "bundled" ? "Volume (branches add up)"
        : a.model.style === "maritime" ? "Volume on each lane (routes add up)" : "Volume per route"));
    for (const v of sampleValues(a.model.dmin, a.model.dmax)) {
        const w = a.model.scale(v), row = div("wfm-legend-row");
        const key = document.createElementNS(SVG_NS, "svg");
        key.setAttribute("width", "34");
        key.setAttribute("height", String(Math.max(12, w + 2)));
        const line = document.createElementNS(SVG_NS, "line");
        for (const [k, val] of Object.entries({ x1: w / 2 + 1, x2: 34 - w / 2 - 1, y1: "50%", y2: "50%", stroke: a.theme.textMuted, "stroke-width": w, "stroke-linecap": "round" })) {
            line.setAttribute(k, String(val));
        }
        key.appendChild(line);
        row.append(key, div("", a.format(v)));
        widths.append(row);
    }
    body.append(widths);

    if (a.colorEntries.length) {
        const sec = div("");
        sec.append(div("wfm-legend-title", a.colorTitle));
        for (const c of a.colorEntries) {
            const row = div("wfm-legend-row"), key = div("wfm-legend-key");
            key.style.background = c.color;
            row.append(key, div("", c.label));
            sec.append(row);
        }
        body.append(sec);
    }

    if (a.terminals !== "off") {
        const row = div("wfm-legend-row");
        const key = document.createElementNS(SVG_NS, "svg");
        key.setAttribute("width", "30");
        key.setAttribute("height", "12");
        const dot = (cx: number, r: number, fill: string, stroke: string, fillOpacity: number) => {
            const c = document.createElementNS(SVG_NS, "circle");
            for (const [k, v] of Object.entries({ cx, cy: 6, r, fill, stroke, "stroke-width": 1.5, "fill-opacity": fillOpacity })) {
                c.setAttribute(k, String(v));
            }
            key.appendChild(c);
        };
        dot(6, 4.5, a.originColor, a.theme.casing, 1);
        dot(22, 4, a.destinationColor, a.destinationColor, 0.22);
        row.append(key, div("", "Origin · Destination"));
        body.append(row);
    }

    if (a.model.style === "maritime") {
        body.append(div("wfm-legend-note", "Indicative sea routes following recorded canal and strait transits; dashed: port approach."));
        if (a.model.unrouted) {
            body.append(div("wfm-legend-note", "⚠ " + a.model.unrouted + " routes found no sea path"));
        }
    }
    if (a.model.limited) {
        body.append(div("wfm-legend-note", a.model.limited + " routes hidden by the bundle limit"));
    }
    if (a.unplaced.rows) {
        body.append(div("wfm-legend-note", "⚠ " + a.unplaced.rows + " rows (" + a.format(a.unplaced.volume) + ") not shown: no usable coordinates"));
    }
}
