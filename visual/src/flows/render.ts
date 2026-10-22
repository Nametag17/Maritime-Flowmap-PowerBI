"use strict";

import { ZoomTransform } from "d3-zoom";
import { line, curveCatmullRom } from "d3-shape";

import { FlowModel, Segment, FlowNode } from "./model";
import { Chokepoint } from "../maritime/chokepoints";
import { View, LEVEL20, WORLD } from "../map/mercator";
import { MapTheme } from "../map/themes";
import { Box, overlaps, textWidth } from "../util";

const SVG_NS = "http://www.w3.org/2000/svg";
const FONT = "\"Segoe UI\", wf_segoe-ui_normal, helvetica, arial, sans-serif";

export interface FlowRenderOptions {
    theme: MapTheme;
    terminals: "bubbles" | "dots" | "off";
    labels: "all" | "origins" | "destinations" | "off";
    /** Show only the text before the first comma ("Installation, Port, Country" → "Installation"). */
    shortNames: boolean;
    labelSize: number;
    /** Labels per 10,000 px² of visual, a cap so the map doesn't drown in names. */
    labelDensity: number;
    opacity: number;
    motion: boolean;
    /** Curved style: bend as a fraction of the route length. */
    curvature: number;
    /** Maritime style: round off the sea-lane network's corners. */
    smooth: boolean;
    /** Chokepoint markers (empty when off), their labels and color, and the volume format for labels. */
    chokepoints: Chokepoint[];
    chokeLabels: "both" | "name" | "off";
    chokeColor: string;
    format: (v: number) => string;
}

const CHOKE_R = 6; // half-diagonal of the chokepoint diamond, px

const smoothLine = line().curve(curveCatmullRom.alpha(0.5));

export type HoverTarget = { kind: "segment"; item: Segment } | { kind: "node"; item: FlowNode } | { kind: "choke"; item: Chokepoint };

export interface FlowHandlers {
    /** Called at most once per animation frame, only when the hovered item changes. */
    hover(target: HoverTarget | null, event: MouseEvent | null): void;
    move(event: MouseEvent): void;
    click(routeIds: number[], event: MouseEvent): void;
    context(routeIds: number[], event: MouseEvent): void;
}

interface SegmentEls { casing: SVGPathElement; line: SVGPathElement; dash: SVGPathElement | null; hit: SVGPathElement; }
interface NodeEls { dot: SVGCircleElement | null; hit: SVGCircleElement; label: SVGTextElement | null; }
interface ChokeEls { mark: SVGPathElement; hit: SVGCircleElement; label: SVGTextElement | null; }

function el<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
    const e = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) {
        e.setAttribute(k, String(attrs[k]));
    }
    parent.appendChild(e);
    return e;
}

/**
 * Draws flows, terminals and labels over the basemap canvas, in two SVG layers:
 *  - base: every flow (casings, lines, direction dashes), composited on its own;
 *  - top:  copies of highlighted flows, invisible hit areas, terminals and labels.
 *
 * That split keeps it fast with thousands of paths. Highlighting fades the whole base layer and
 * copies only the highlighted paths on top (no restyling of every path). While the map is panned
 * or zoomed the base layer moves as one bitmap with a CSS transform and is rebuilt exactly when the
 * gesture ends (tree branch offsets are in screen pixels, so paths can't simply be scaled).
 * Mouse events are delegated and coalesced to one hover change per frame.
 */
export class FlowLayer {
    private g: Record<"casings" | "lines" | "dashes" | "highlight" | "hits" | "nodes" | "chokes" | "labels", SVGGElement>;
    private model: FlowModel | null = null;
    private opts: FlowRenderOptions | null = null;
    private segs: Segment[] = [];
    private segEls: SegmentEls[] = [];
    private nodes: FlowNode[] = [];
    private nodeEls: NodeEls[] = [];
    private nodePos: [number, number][] = [];
    private chokes: Chokepoint[] = [];
    private chokeEls: ChokeEls[] = [];
    private chokePos: [number, number][] = [];
    /** The transform the paths were last built for; gestures move the layers relative to it. */
    private built: ZoomTransform | null = null;
    private highlighted: Set<number> | null = null;
    private dimmedNodes = new Set<Element>();
    private hoverPending: { target: HoverTarget | null; event: MouseEvent | null } | null = null;
    private hoverCurrent: HoverTarget | null = null;
    private hoverFrame = 0;

    constructor(private base: SVGSVGElement, private top: SVGSVGElement, private handlers: FlowHandlers) {
        const g = (parent: Element, name: string) => el(parent, "g", { class: "wfm-" + name });
        this.g = {
            casings: g(base, "casings"), lines: g(base, "lines"), dashes: g(base, "dashes"),
            highlight: g(top, "highlight"), hits: g(top, "hits"), nodes: g(top, "nodes"), chokes: g(top, "chokes"), labels: g(top, "labels")
        };
        top.addEventListener("mouseover", e => this.queueHover(this.targetOf(e.target), e));
        top.addEventListener("mouseout", e => {
            if (!this.targetOf(e.relatedTarget)) {
                this.queueHover(null, null);
            }
        });
        top.addEventListener("mousemove", e => {
            if (this.hoverCurrent) {
                this.handlers.move(e);
            }
        });
        top.addEventListener("click", e => {
            const t = this.targetOf(e.target);
            if (t) {
                e.stopImmediatePropagation(); // the visual's background handler is on the same element
                this.handlers.click(t.item.routeIds, e);
            }
        });
        top.addEventListener("contextmenu", e => {
            const t = this.targetOf(e.target);
            if (t) {
                e.preventDefault();
                e.stopImmediatePropagation(); // the visual's background handler is on the same element
                this.handlers.context(t.item.routeIds, e);
            }
        });
    }

    private targetOf(node: EventTarget | null): HoverTarget | null {
        const target = node as Element | null;
        if (!target || !target.getAttribute) {
            return null;
        }
        const s = target.getAttribute("data-seg"), n = target.getAttribute("data-node"), c = target.getAttribute("data-choke");
        if (s !== null) {
            return { kind: "segment", item: this.segs[+s] };
        }
        if (n !== null) {
            return { kind: "node", item: this.nodes[+n] };
        }
        if (c !== null) {
            return { kind: "choke", item: this.chokes[+c] };
        }
        return null;
    }

    private queueHover(target: HoverTarget | null, event: MouseEvent | null): void {
        this.hoverPending = { target, event };
        if (!this.hoverFrame) {
            this.hoverFrame = requestAnimationFrame(() => {
                this.hoverFrame = 0;
                const p = this.hoverPending;
                this.hoverPending = null;
                const same = p.target && this.hoverCurrent ? p.target.item === this.hoverCurrent.item : !p.target && !this.hoverCurrent;
                if (!same) {
                    this.hoverCurrent = p.target;
                    this.handlers.hover(p.target, p.event);
                }
            });
        }
    }

    public render(model: FlowModel, opts: FlowRenderOptions): void {
        this.model = model;
        this.opts = opts;
        for (const g of Object.values(this.g)) {
            g.replaceChildren();
        }
        this.built = null;
        this.highlighted = null;
        this.dimmedNodes.clear();
        this.hoverCurrent = null;
        this.base.style.opacity = "";
        this.segs = model.segments;
        this.nodes = model.nodes;
        // The engine draws tree branches from the leaf toward the root, so dashes run backwards
        // when bundling from the origin.
        const reverse = model.style === "bundled" && model.bundleFrom === "origin";

        this.segEls = this.segs.map((s, i) => {
            const w = s.width;
            return {
                casing: el(this.g.casings, "path", { class: "wfm-casing", "stroke-width": w + 2, stroke: opts.theme.casing }),
                line: el(this.g.lines, "path", {
                    class: "wfm-flow" + (s.kind === "approach" ? " wfm-approach" : ""), "stroke-width": w, stroke: s.color, "stroke-opacity": opts.opacity
                }),
                // Lanes are shared by routes going both ways, so they get no direction dashes.
                dash: opts.motion && !s.kind ? el(this.g.dashes, "path", { class: "wfm-dash" + (reverse ? " wfm-rev" : ""), "stroke-width": Math.max(1.2, w * 0.32) }) : null,
                hit: el(this.g.hits, "path", { class: "wfm-hit", "stroke-width": Math.max(w + 6, 10), "data-seg": i })
            };
        });

        this.nodeEls = this.nodes.map((n, i) => {
            const showLabel = opts.labels === "all" || (opts.labels === "origins" && n.role === "origin") ||
                (opts.labels === "destinations" && n.role === "destination");
            const els: NodeEls = {
                dot: opts.terminals === "off" ? null : el(this.g.nodes, "circle", {
                    class: "wfm-term wfm-" + n.role, r: n.r, fill: n.fill,
                    stroke: n.role === "destination" ? n.fill : opts.theme.casing
                }),
                hit: el(this.g.nodes, "circle", { class: "wfm-term-hit", r: Math.max(n.r + 4, 11), "data-node": i }),
                label: null
            };
            if (showLabel) {
                els.label = el(this.g.labels, "text", {
                    class: "wfm-label" + (n.role === "destination" ? " wfm-label-dest" : ""),
                    fill: opts.theme.text, stroke: opts.theme.halo, "font-size": opts.labelSize
                });
                els.label.textContent = this.labelText(n); // data: textContent only
            }
            return els;
        });

        // Chokepoints: a diamond per passage, above the terminals; labels take priority over terminal labels.
        this.chokes = opts.chokepoints;
        this.chokeEls = this.chokes.map((c, i) => {
            const els: ChokeEls = {
                mark: el(this.g.chokes, "path", {
                    class: "wfm-choke", d: `M0,${-CHOKE_R}L${CHOKE_R},0L0,${CHOKE_R}L${-CHOKE_R},0Z`, fill: opts.chokeColor, stroke: opts.theme.casing
                }),
                hit: el(this.g.chokes, "circle", { class: "wfm-term-hit", r: 11, "data-choke": i }),
                label: null
            };
            if (opts.chokeLabels !== "off") {
                els.label = el(this.g.labels, "text", {
                    class: "wfm-label wfm-label-choke", fill: opts.chokeColor, stroke: opts.theme.halo, "font-size": opts.labelSize
                });
                els.label.textContent = opts.chokeLabels === "both" && c.basis !== "none" ? c.name + " · " + opts.format(c.volume) : c.name;
            }
            return els;
        });
    }

    /**
     * Positions everything for the view. During a gesture the base layer only gets a CSS transform
     * (no repaint), terminals follow, and highlight copies and labels are hidden until it ends.
     */
    public update(view: View, obstacles: Box[], interacting: boolean): void {
        if (!this.model) {
            return;
        }
        const t = view.t;
        this.top.classList.toggle("wfm-moving", interacting);
        if (interacting && this.built) {
            const s = t.k / this.built.k, m = `matrix(${s},0,0,${s},${t.x - this.built.x * s},${t.y - this.built.y * s})`;
            this.base.style.transform = m;
            this.g.highlight.setAttribute("transform", m); // a clicked selection follows the gesture
            this.positionNodes(t);
            return;
        }
        this.base.style.transform = "";
        this.g.highlight.removeAttribute("transform");
        this.built = t;
        const sx = (bx: number) => t.x + t.k * bx, sy = (by: number) => t.y + t.k * by;
        this.segs.forEach((s, i) => {
            const d = this.segmentPath(s, sx, sy, t);
            const els = this.segEls[i];
            els.casing.setAttribute("d", d);
            els.line.setAttribute("d", d);
            els.hit.setAttribute("d", d);
            if (els.dash) {
                els.dash.setAttribute("d", d);
            }
        });
        this.positionNodes(t);
        this.placeLabels(view, obstacles);
        this.drawHighlight();
    }

    private positionNodes(t: ZoomTransform): void {
        this.nodes.forEach((n, i) => {
            const x = t.x + t.k * n.place.bx, y = t.y + t.k * n.place.by;
            this.nodePos[i] = [x, y];
            const els = this.nodeEls[i];
            if (els.dot) {
                els.dot.setAttribute("cx", String(x));
                els.dot.setAttribute("cy", String(y));
            }
            els.hit.setAttribute("cx", String(x));
            els.hit.setAttribute("cy", String(y));
        });
        this.chokes.forEach((c, i) => {
            const x = t.x + t.k * c.bx, y = t.y + t.k * c.by;
            this.chokePos[i] = [x, y];
            const els = this.chokeEls[i];
            els.mark.setAttribute("transform", `translate(${x.toFixed(1)},${y.toFixed(1)})`);
            els.hit.setAttribute("cx", String(x));
            els.hit.setAttribute("cy", String(y));
        });
    }

    private segmentPath(s: Segment, sx: (x: number) => number, sy: (y: number) => number, t: ZoomTransform): string {
        if (s.path) {
            const { bx, by } = s.source;
            return s.path.d((input: number[], out: number[]) => {
                out[0] = t.x + t.k * (bx + input[0] / LEVEL20);
                out[1] = t.y + t.k * (by + input[1] / LEVEL20);
            });
        }
        if (s.kind) {
            // Sea lanes running past the date line are drawn again one world over, so both halves show.
            let minX = Infinity, maxX = -Infinity;
            for (const [x] of s.pts) {
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
            }
            const shifts = [0].concat(minX < 0 ? [WORLD] : [], maxX > WORLD ? [-WORLD] : []);
            return shifts.map(dx => {
                const screen = s.pts.map(([x, y]) => [sx(x + dx), sy(y)] as [number, number]);
                return s.kind === "lane" && this.opts.smooth && screen.length > 2
                    ? smoothLine(screen)
                    : "M" + screen.map(([x, y]) => x.toFixed(1) + "," + y.toFixed(1)).join("L");
            }).join(" ");
        }
        if (s.pts) {
            return "M" + s.pts.map(([x, y]) => sx(x).toFixed(1) + "," + sy(y).toFixed(1)).join("L");
        }
        const a = this.model.places.get(s.route.origin.key), b = this.model.places.get(s.route.destination.key);
        const x0 = sx(a.bx), y0 = sy(a.by), x1 = sx(b.bx), y1 = sy(b.by);
        if (this.model.style === "curved") {
            // Bend to the right of travel, so A→B and B→A never sit on top of each other.
            const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, dx = x1 - x0, dy = y1 - y0, c = this.opts.curvature;
            return `M${x0},${y0}Q${mx - dy * c},${my + dx * c} ${x1},${y1}`;
        }
        return `M${x0},${y0}L${x1},${y1}`;
    }

    private labelText(n: FlowNode): string {
        const name = n.place.t.name;
        return this.opts.shortNames ? name.split(",")[0].trim() || name : name;
    }

    /** Greedy, collision-free labels: heaviest terminals first, capped by the space available. */
    private placeLabels(view: View, obstacles: Box[]): void {
        const o = this.opts, boxes = obstacles.slice();
        this.chokes.forEach((c, i) => {
            const [x, y] = this.chokePos[i];
            boxes.push({ x0: x - CHOKE_R, y0: y - CHOKE_R, x1: x + CHOKE_R, y1: y + CHOKE_R });
        });
        // Chokepoint labels first, and allowed over terminal dots (their halo keeps them readable): there
        // are at most five, and they are what the map is often read for.
        this.chokes.forEach((c, i) => {
            const label = this.chokeEls[i].label;
            if (label) {
                const [x, y] = this.chokePos[i];
                this.placeLabel(label, x, y, CHOKE_R, "600 ", view, boxes);
            }
        });
        if (o.terminals !== "off") {
            this.nodes.forEach((n, i) => {
                const [x, y] = this.nodePos[i];
                boxes.push({ x0: x - n.r, y0: y - n.r, x1: x + n.r, y1: y + n.r });
            });
        }
        const maxLabels = Math.max(5, Math.round(view.W * view.H / 10000 * o.labelDensity));
        let placed = 0;
        this.nodes.forEach((n, i) => {
            const label = this.nodeEls[i].label;
            if (!label) {
                return;
            }
            if (placed >= maxLabels) {
                label.style.display = "none";
                return;
            }
            const [x, y] = this.nodePos[i];
            if (this.placeLabel(label, x, y, o.terminals === "off" ? 2 : n.r, n.role === "destination" ? "400 " : "600 ", view, boxes)) {
                placed++;
            }
        });
    }

    /** Puts a label beside its point (right, left, above or below), clear of the boxes already taken. */
    private placeLabel(label: SVGTextElement, x: number, y: number, r: number, weight: string, view: View, boxes: Box[]): boolean {
        if (x < 0 || y < 0 || x > view.W || y > view.H) {
            label.style.display = "none";
            return false;
        }
        const size = this.opts.labelSize;
        const w = textWidth(label.textContent, weight + size + "px " + FONT), h = size + 2;
        const options: [number, number, string][] = [
            [x + r + 4, y - h / 2, "start"],
            [x - r - 4 - w, y - h / 2, "end"],
            [x - w / 2, y - r - 3 - h, "middle"],
            [x - w / 2, y + r + 3, "middle"]
        ];
        for (const [x0, y0, anchor] of options) {
            const box = { x0, y0, x1: x0 + w, y1: y0 + h };
            if (box.x0 < 2 || box.y0 < 2 || box.x1 > view.W - 2 || box.y1 > view.H - 2 || overlaps(box, boxes)) {
                continue;
            }
            label.setAttribute("x", String(anchor === "start" ? x0 : anchor === "end" ? x0 + w : x0 + w / 2));
            label.setAttribute("y", String(y0 + h - 3));
            label.setAttribute("text-anchor", anchor);
            label.style.display = "";
            boxes.push(box);
            return true;
        }
        label.style.display = "none";
        return false;
    }

    /** Highlights the flows and terminals carrying the given routes and fades the rest (null: all). */
    public highlight(ids: Set<number> | null): void {
        this.highlighted = ids;
        this.drawHighlight();
    }

    private drawHighlight(): void {
        const ids = this.highlighted;
        this.g.highlight.replaceChildren();
        this.base.style.opacity = ids ? "0.14" : "";
        const on = (list: number[]) => !ids || list.some(id => ids.has(id));
        if (ids) {
            // Copy the highlighted paths above the faded layer, casings first, in drawing order.
            const lit = this.segs.map((s, i) => (on(s.routeIds) ? i : -1)).filter(i => i >= 0);
            for (const kind of ["casing", "line", "dash"] as const) {
                for (const i of lit) {
                    const src = this.segEls[i][kind];
                    if (src) {
                        this.g.highlight.appendChild(src.cloneNode(false));
                    }
                }
            }
        }
        // Terminals and labels are few; dim those not involved, touching only changed elements.
        const dim = new Set<Element>();
        this.nodes.forEach((n, i) => {
            if (!on(n.routeIds)) {
                const els = this.nodeEls[i];
                if (els.dot) dim.add(els.dot);
                if (els.label) dim.add(els.label);
            }
        });
        // Chokepoints the highlighted routes don't pass fade too, so a hovered route shows its passages.
        this.chokes.forEach((c, i) => {
            if (!on(c.routeIds)) {
                const els = this.chokeEls[i];
                dim.add(els.mark);
                if (els.label) dim.add(els.label);
            }
        });
        for (const e of this.dimmedNodes) {
            if (!dim.has(e)) e.classList.remove("wfm-dim");
        }
        for (const e of dim) {
            if (!this.dimmedNodes.has(e)) e.classList.add("wfm-dim");
        }
        this.dimmedNodes = dim;
    }

    /** Base-coordinate extent of what is drawn, for fit-to-data. */
    public extent(): [[number, number], [number, number]] | null {
        if (!this.model || !this.model.nodes.length) {
            return null;
        }
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        const add = (x: number, y: number) => {
            x = Math.max(0, Math.min(WORLD, x)); // sea lanes unwrapped past the date line
            x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        };
        for (const n of this.model.nodes) {
            add(n.place.bx, n.place.by);
        }
        for (const s of this.model.segments) {
            for (const [x, y] of s.pts || []) {
                add(x, y);
            }
        }
        return [[x0, y0], [x1, y1]];
    }
}
