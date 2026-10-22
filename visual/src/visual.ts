/*
 *  Maritime Flow Map: a Power BI flow map for seaborne cargo, without any map service.
 *
 *  The basemap is drawn from bundled Natural Earth data; flows are drawn with the original Flowmap
 *  engine (src/engine, MIT © Weiwei Cui) or as great-circle / curved / straight lines.
 */
"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService, formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import { valueFormatter } from "powerbi-visuals-utils-formattingutils";
import { select, pointer } from "d3-selection";
import { zoom, zoomIdentity, ZoomBehavior } from "d3-zoom";
import "d3-transition"; // adds selection.transition(), used for animated zoom
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;

import { VisualFormattingSettingsModel, choice, colorOr } from "./settings";
import { parseDataView, ParsedData, Route } from "./data";
import { buildModel, FlowModel, FlowStyle } from "./flows/model";
import { FlowLayer, HoverTarget } from "./flows/render";
import { chokepoints, ChokepointSet } from "./maritime/chokepoints";
import { drawBasemap, needsHighRes } from "./map/basemap";
import { geoHigh } from "./map/geo";
import { View, WORLD } from "./map/mercator";
import { THEMES, ThemeName, MapTheme } from "./map/themes";
import { renderLegend } from "./ui/legend";
import { describeSegment, describeNode, describeChokepoint, toPowerBI, TooltipContext } from "./ui/tooltip";
import { RichTooltip } from "./ui/richTooltip";
import { boxOf, Box } from "./util";

const MAX_K = 2 ** 11; // past ≈ Bing zoom 11 the 1:10m coastline only gets blockier

export class Visual implements IVisual {
    private host: IVisualHost;
    private events: IVisualEventService;
    private selection: ISelectionManager;
    private formatting = new FormattingSettingsService();
    private settings: VisualFormattingSettingsModel;

    private root: HTMLDivElement;
    private canvas: HTMLCanvasElement;
    /** Base flow layer (all flows), under the interactive top layer. */
    private baseSvg: SVGSVGElement;
    /** Top layer: hit areas, terminals, labels, highlight copies; also the zoom/pan target. */
    private svg: SVGSVGElement;
    /** Transform the basemap canvas was last drawn for; gestures only move the canvas relative to it. */
    private canvasBuilt: View["t"] | null = null;
    private legendEl: HTMLDivElement;
    private zoomBar: HTMLDivElement;
    private help: HTMLDivElement;
    private flows: FlowLayer;
    private richTip: RichTooltip;
    private zoomBehavior: ZoomBehavior<SVGSVGElement, unknown>;

    private view: View = { W: 0, H: 0, t: zoomIdentity };
    private dpr = 1;
    private interacting = false;
    private frame = 0;
    private data: ParsedData | null = null;
    private model: FlowModel | null = null;
    private theme: MapTheme = THEMES.navy;
    private modelKey = "";
    private dataKey = "";
    private fitted = false;
    private legendCollapsed = false;
    private rowIds: ISelectionId[][] = [];
    private routeByKey = new Map<string, number>();
    private selected: Set<number> | null = null;
    private hovered: Set<number> | null = null;
    private tooltip: TooltipContext | null = null;
    private tooltipItems: VisualTooltipDataItem[] = [];
    private tooltipIds: ISelectionId[] = [];
    private tooltipMove: MouseEvent | null = null;
    private tooltipFrame = 0;
    /** Legend and zoom-bar boxes for label collision, measured once per layout change, not per frame. */
    private obstacleBoxes: Box[] = [];
    private format: (v: number) => string = v => v.toLocaleString();
    private colorEntries: { label: string; color: string }[] = [];

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = this.host.eventService;
        this.selection = this.host.createSelectionManager();
        this.selection.registerOnSelectCallback(ids => this.syncSelection(ids as ISelectionId[]));

        this.root = document.createElement("div");
        this.root.className = "wfm-root";
        this.canvas = document.createElement("canvas");
        this.canvas.className = "wfm-basemap";
        this.baseSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        this.baseSvg.setAttribute("class", "wfm-base");
        this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        this.svg.setAttribute("class", "wfm-overlay");
        this.legendEl = document.createElement("div");
        this.zoomBar = document.createElement("div");
        this.zoomBar.className = "wfm-zoombar";
        this.help = document.createElement("div");
        this.help.className = "wfm-help";
        this.root.append(this.canvas, this.baseSvg, this.svg, this.legendEl, this.zoomBar, this.help);
        options.element.appendChild(this.root);
        this.richTip = new RichTooltip(this.root);

        this.flows = new FlowLayer(this.baseSvg, this.svg, {
            hover: (target, event) => this.onHover(target, event),
            move: event => this.moveTooltip(event),
            click: (ids, event) => this.onClick(ids, event),
            context: (ids, event) => this.showContextMenu(ids, event)
        });

        this.zoomBehavior = zoom<SVGSVGElement, unknown>()
            .scaleExtent([1, MAX_K])
            .translateExtent([[0, 0], [WORLD, WORLD]])
            .on("start", () => { this.interacting = true; this.hideTooltip(); })
            .on("zoom", e => { this.view.t = e.transform; this.schedule(); })
            .on("end", () => { this.interacting = false; this.schedule(); });
        select(this.svg).call(this.zoomBehavior);

        this.svg.addEventListener("click", () => this.clearSelection());
        this.svg.addEventListener("contextmenu", e => { e.preventDefault(); this.showContextMenu([], e); });

        const button = (label: string, title: string, action: () => void) => {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = label;
            b.title = title;
            b.setAttribute("aria-label", title);
            b.addEventListener("click", e => { e.stopPropagation(); action(); });
            this.zoomBar.appendChild(b);
        };
        button("+", "Zoom in", () => select(this.svg).transition().duration(250).call(this.zoomBehavior.scaleBy, 2));
        button("−", "Zoom out", () => select(this.svg).transition().duration(250).call(this.zoomBehavior.scaleBy, 0.5));
        button("⤢", "Fit all flows", () => this.fit(true));
    }

    public update(options: VisualUpdateOptions): void {
        this.events.renderingStarted(options);
        try {
            const dataView = options.dataViews && options.dataViews[0];
            this.settings = this.formatting.populateFormattingSettingsModel(VisualFormattingSettingsModel, dataView);
            this.resize(options.viewport.width, options.viewport.height);

            const data = parseDataView(dataView);
            if (data.missing.length) {
                this.showHelp(data.missing);
                this.events.renderingFinished(options);
                return;
            }
            this.help.style.display = "none";
            this.data = data;
            this.buildSelectionIds(data);
            const colors = this.buildColors(data);
            const theme = this.resolveTheme();
            if (JSON.stringify(theme) !== JSON.stringify(this.theme)) {
                this.canvasBuilt = null; // map colors changed: the cached basemap is stale
            }
            this.theme = theme;
            this.root.style.background = theme.ocean; // what shows where a pan reveals undrawn map
            this.format = this.formatterFor(data);
            this.applyInteractivity();

            // Rebuild the model only when the data or a setting it depends on changed; plain
            // resizes just redraw (the bundled layout is the expensive part).
            const s = this.settings;
            const dataKey = dataSignature(data);
            const modelKey = dataKey + JSON.stringify([
                choice(s.flowStyle.style), choice(s.flowStyle.bundleFrom), s.flowStyle.flowLimit.value, s.lines.minWidth.value,
                s.lines.maxWidth.value, choice(s.lines.widthScale), choice(s.terminals.show), s.terminals.bubbleMax.value,
                colorOr(s.terminals.destinationColor, ""), colors.signature, choice(s.map.theme),
                s.maritime.follow.value, s.maritime.blockArctic.value, s.maritime.approaches.value
            ]);
            if (modelKey !== this.modelKey || !this.model) {
                this.modelKey = modelKey;
                this.model = buildModel(data.routes, {
                    style: choice<FlowStyle>(s.flowStyle.style),
                    bundleFrom: choice(s.flowStyle.bundleFrom),
                    flowLimit: s.flowStyle.flowLimit.value,
                    minWidth: Math.min(s.lines.minWidth.value, s.lines.maxWidth.value),
                    maxWidth: Math.max(s.lines.minWidth.value, s.lines.maxWidth.value),
                    widthScale: choice(s.lines.widthScale),
                    terminals: choice(s.terminals.show),
                    bubbleMax: s.terminals.bubbleMax.value,
                    colorOf: colors.of,
                    colorKey: r => String(r.group),
                    destinationColor: colorOr(s.terminals.destinationColor, this.theme.destination),
                    maritime: { follow: s.maritime.follow.value, blockArctic: s.maritime.blockArctic.value, approaches: s.maritime.approaches.value }
                });
            }
            const cp = s.chokepoints;
            this.flows.render(this.model, {
                theme: this.theme,
                terminals: choice(s.terminals.show),
                labels: choice(s.labels.show),
                shortNames: s.labels.shortNames.value,
                labelSize: s.labels.fontSize.value,
                labelDensity: s.labels.density.value / 10,
                opacity: s.lines.opacity.value / 100,
                motion: s.flowStyle.motion.value,
                curvature: s.flowStyle.curvature.value / 100,
                smooth: s.maritime.smooth.value,
                chokepoints: cp.show.value ? chokepoints(data.routes, this.model.sea, choice<ChokepointSet>(cp.which), cp.onlyActive.value) : [],
                chokeLabels: choice(cp.label),
                chokeColor: this.chokeColor(),
                format: this.format
            });
            this.tooltip = {
                sea: this.model.sea, followTransits: s.maritime.follow.value,
                shortNames: s.tooltip.shortNames.value, maxRows: s.tooltip.maxRows.value, colorOf: colors.of,
                data, routes: data.routes, format: this.format, volumeName: data.names.volume,
                colorName: data.names.color, canalName: data.names.canal, bundleFrom: choice(s.flowStyle.bundleFrom),
                total: data.routes.reduce((sum, r) => sum + r.volume, 0)
            };
            this.renderLegend();

            if (dataKey !== this.dataKey) {
                this.dataKey = dataKey;
                this.syncSelection(this.selection.getSelectionIds() as ISelectionId[]);
                if (s.map.autoFit.value || !this.fitted) {
                    this.fit(false);
                }
            }
            this.renderNow();
            this.flows.highlight(this.hovered || this.selected);
            this.events.renderingFinished(options);
        }
        catch (e) {
            this.events.renderingFailed(options, String(e));
            throw e;
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formatting.buildFormattingModel(this.settings);
    }

    // ------------------------------------------------------------------ layout & drawing

    private resize(width: number, height: number): void {
        const dpr = window.devicePixelRatio || 1;
        if (width === this.view.W && height === this.view.H && dpr === this.dpr) {
            return;
        }
        this.view.W = width;
        this.view.H = height;
        this.dpr = dpr;
        this.canvas.width = Math.round(width * dpr); // clears the canvas; update() redraws right after
        this.canvas.height = Math.round(height * dpr);
        this.canvas.style.width = width + "px";
        this.canvas.style.height = height + "px";
        this.canvasBuilt = null;
        for (const svg of [this.baseSvg, this.svg]) {
            svg.setAttribute("width", String(width));
            svg.setAttribute("height", String(height));
        }
        const kMin = Math.max(width, height) / WORLD;
        this.zoomBehavior.extent([[0, 0], [width, height]]).scaleExtent([kMin, MAX_K]);
        select(this.svg).call(this.zoomBehavior.transform, this.view.t); // re-clamp to the new size
    }

    private schedule(): void {
        if (!this.frame) {
            this.frame = requestAnimationFrame(() => {
                this.frame = 0;
                this.renderNow();
            });
        }
    }

    private renderNow(): void {
        if (this.frame) {
            cancelAnimationFrame(this.frame);
            this.frame = 0;
        }
        if (!this.view.W || !this.view.H || !this.settings) {
            return;
        }
        const m = this.settings.map, t = this.view.t, built = this.canvasBuilt;
        if (this.interacting && built) {
            // Mid-gesture: move the last drawn basemap as a bitmap; it's redrawn sharp when the gesture ends.
            const s = t.k / built.k;
            this.canvas.style.transform = `matrix(${s},0,0,${s},${t.x - built.x * s},${t.y - built.y * s})`;
        }
        else {
            this.canvas.style.transform = "";
            drawBasemap(this.canvas, this.dpr, this.view, this.theme, {
                countryLabels: m.countryLabels.value, seaLabels: m.seaLabels.value, usStates: m.usStates.value, interacting: false
            }, this.obstacleBoxes);
            this.canvasBuilt = t;
        }
        this.flows.update(this.view, this.obstacleBoxes, this.interacting);
        if (!this.interacting && needsHighRes(this.view)) {
            // Prepare the 1:10m coastlines once, after this frame, then redraw with them.
            setTimeout(() => { geoHigh(); this.schedule(); }, 0);
        }
    }

    private measureObstacles(): void {
        const boxes: Box[] = [];
        if (this.zoomBar.style.display !== "none") {
            boxes.push(boxOf(this.zoomBar, this.root));
        }
        if (this.legendEl.style.display !== "none") {
            boxes.push(boxOf(this.legendEl, this.root));
        }
        this.obstacleBoxes = boxes;
    }

    private fit(animate: boolean): void {
        const e = this.flows.extent();
        if (!e || !this.view.W) {
            return;
        }
        const [[x0, y0], [x1, y1]] = e;
        const padX = 60, padTop = 40, padBottom = 30;
        const dx = Math.max(x1 - x0, 1e-4), dy = Math.max(y1 - y0, 1e-4);
        const kMin = Math.max(this.view.W, this.view.H) / WORLD;
        let k = Math.min((this.view.W - 2 * padX) / dx, (this.view.H - padTop - padBottom) / dy);
        k = Math.max(kMin, Math.min(k, 2 ** 10));
        const t = zoomIdentity
            .translate(this.view.W / 2 - k * (x0 + x1) / 2, (this.view.H + padTop - padBottom) / 2 - k * (y0 + y1) / 2)
            .scale(k);
        const svg = select(this.svg);
        if (animate) {
            svg.transition().duration(600).call(this.zoomBehavior.transform, t);
        }
        else {
            svg.call(this.zoomBehavior.transform, t);
        }
        this.fitted = true;
    }

    private resolveTheme(): MapTheme {
        const m = this.settings.map;
        const base = THEMES[choice<ThemeName>(m.theme)] || THEMES.navy;
        const palette = this.host.colorPalette;
        if (palette.isHighContrast) {
            const fg = palette.foreground.value, bg = palette.background.value;
            return {
                ...base, ocean: bg, land: bg, coast: fg, border: fg, state: fg, countryLabel: fg, seaLabel: fg,
                text: fg, textMuted: fg, halo: bg, casing: bg, panel: bg, panelBorder: fg, destination: fg, other: fg
            };
        }
        return {
            ...base,
            ocean: colorOr(m.ocean, base.ocean),
            land: colorOr(m.land, base.land),
            border: colorOr(m.borders, base.border),
            text: colorOr(this.settings.labels.color, base.text)
        };
    }

    /** Chokepoint markers stand out in the report's high-contrast foreground when that mode is on. */
    private chokeColor(): string {
        const palette = this.host.colorPalette;
        return palette.isHighContrast ? palette.foreground.value : colorOr(this.settings.chokepoints.color, "#f2b134");
    }

    /**
     * The measure's own format string, without Power BI's automatic display units: in oil and gas
     * "M" means thousand, so an auto "245.3M" would mislead. The dashboard shows full numbers.
     */
    private formatterFor(data: ParsedData): (v: number) => string {
        const f = valueFormatter.create({ format: data.volumeFormat || "#,0" });
        return v => f.format(v);
    }

    private renderLegend(): void {
        const s = this.settings;
        renderLegend(this.legendEl, {
            show: s.legend.show.value,
            position: choice(s.legend.position),
            fontSize: s.legend.fontSize.value,
            theme: this.theme,
            model: this.model,
            format: this.format,
            colorTitle: this.data.names.color || "",
            colorEntries: this.colorEntries,
            terminals: choice(s.terminals.show),
            originColor: this.data.colorBound ? this.theme.other : colorOr(s.lines.color, "#e66c37"),
            destinationColor: colorOr(s.terminals.destinationColor, this.theme.destination),
            chokeColor: s.chokepoints.show.value ? this.chokeColor() : null,
            unplaced: this.data.unplaced,
            collapsed: this.legendCollapsed,
            onToggle: () => {
                this.legendCollapsed = !this.legendCollapsed;
                this.renderLegend();
                this.renderNow();
            }
        });
        this.measureObstacles();
    }

    private showHelp(missing: string[]): void {
        this.flows.render({
            style: "straight", bundleFrom: "origin", segments: [], nodes: [], places: new Map(), scale: () => 0, dmin: 0, dmax: 0,
            limited: 0, sea: new Map(), unrouted: 0
        }, {
            theme: this.theme, terminals: "off", labels: "off", shortNames: true, labelSize: 11, labelDensity: 1, opacity: 1,
            motion: false, curvature: 0, smooth: true, chokepoints: [], chokeLabels: "off", chokeColor: "", format: this.format
        });
        this.model = null;
        this.legendEl.style.display = "none";
        this.help.replaceChildren();
        this.help.style.display = "";
        const h = document.createElement("h3");
        h.textContent = "Maritime Flow Map";
        const p = document.createElement("p");
        p.textContent = "To draw flows, add:";
        const ul = document.createElement("ul");
        for (const m of missing) {
            const li = document.createElement("li");
            li.textContent = m;
            ul.appendChild(li);
        }
        const note = document.createElement("p");
        note.className = "wfm-note";
        note.textContent = "Coordinates: latitude and longitude in decimal degrees, as number columns (text holding a number " +
            "also works). If your data has one combined \"lat, lon\" column, split it in Power Query " +
            "(Split Column > By delimiter > comma). Nothing is geocoded.";
        this.help.append(h, p, ul, note);
        const ctx = this.canvas.getContext("2d");
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, this.view.W, this.view.H);
    }

    // ------------------------------------------------------------------ colors

    /**
     * Single color, or one color per "Color by" value. Category colors are saved on the series
     * identity, so they survive any filter (row identities would not).
     */
    private buildColors(data: ParsedData): { of: (r: Route) => string; signature: string } {
        const s = this.settings;
        const single = colorOr(s.lines.color, "#e66c37");
        this.colorEntries = [];
        s.colors.slices = [];
        if (!data.colorBound) {
            s.colors.visible = false;
            return { of: () => single, signature: single };
        }
        s.colors.visible = true;
        const palette = this.host.colorPalette;
        const byGroup = data.series.map(sr => {
            const saved = sr.group.objects && sr.group.objects.colors && sr.group.objects.colors.fill as powerbi.Fill;
            const color = saved && saved.solid ? saved.solid.color : palette.getColor(sr.name || "").value;
            const selector = this.host.createSelectionIdBuilder().withSeries(data.values, sr.group).createSelectionId().getSelector();
            s.colors.slices.push(new formattingSettings.ColorPicker({ name: "fill", displayName: sr.name || "(blank)", value: { value: color }, selector }));
            this.colorEntries.push({ label: sr.name || "(blank)", color });
            return color;
        });
        return { of: r => byGroup[r.group] || single, signature: byGroup.join(",") };
    }

    // ------------------------------------------------------------------ selection & tooltips

    private buildSelectionIds(data: ParsedData): void {
        this.rowIds = [];
        this.routeByKey.clear();
        for (const r of data.routes) {
            const series = data.series[r.group];
            this.rowIds[r.id] = r.rows.map(row => {
                let b = this.host.createSelectionIdBuilder().withCategory(data.rowColumn, row);
                if (series && data.values && data.colorBound) {
                    b = b.withSeries(data.values, series.group);
                }
                const id = b.createSelectionId();
                this.routeByKey.set(id.getKey(), r.id);
                return id;
            });
        }
    }

    private idsFor(routeIds: number[]): ISelectionId[] {
        return [].concat(...routeIds.map(id => this.rowIds[id] || []));
    }

    private onClick(routeIds: number[], event: MouseEvent): void {
        if (!this.host.hostCapabilities.allowInteractions) {
            return;
        }
        const multi = event.ctrlKey || event.metaKey || event.shiftKey;
        this.selection.select(this.idsFor(routeIds), multi).then(ids => this.syncSelection(ids as ISelectionId[]));
    }

    private clearSelection(): void {
        if (this.selected) {
            this.selection.clear().then(() => this.syncSelection([]));
        }
    }

    /** Maps the host's selection (ours, a bookmark, or cleared elsewhere) back to routes. */
    private syncSelection(ids: ISelectionId[]): void {
        if (!ids || !ids.length) {
            this.selected = null;
        }
        else {
            const set = new Set<number>();
            for (const id of ids) {
                const r = this.routeByKey.get(id.getKey());
                if (r !== undefined) {
                    set.add(r);
                }
            }
            this.selected = set.size ? set : null;
        }
        this.flows.highlight(this.hovered || this.selected);
    }

    private showContextMenu(routeIds: number[], event: MouseEvent): void {
        const ids = this.idsFor(routeIds);
        this.selection.showContextMenu(ids.length ? ids[0] : ({} as ISelectionId), { x: event.clientX, y: event.clientY });
    }

    private onHover(target: HoverTarget | null, event: MouseEvent | null): void {
        this.hovered = target ? new Set(target.item.routeIds) : null;
        this.flows.highlight(this.hovered || this.selected);
        if (!target || !event || this.interacting) {
            this.hideTooltip();
            return;
        }
        const model = target.kind === "node" ? describeNode(target.item, this.tooltip)
            : target.kind === "choke" ? describeChokepoint(target.item, this.tooltip, this.chokeColor())
                : describeSegment(target.item, this.tooltip);
        const [x, y] = pointer(event, this.root);
        if (this.builtInTooltip()) {
            const t = this.settings.tooltip;
            this.richTip.show(model, choice(t.theme), t.fontSize.value, x, y);
            return;
        }
        // Power BI's tooltip; with identities it can also show a report page tooltip for these routes.
        this.tooltipItems = toPowerBI(model);
        this.tooltipIds = this.idsFor(target.item.routeIds);
        this.host.tooltipService.show({ dataItems: this.tooltipItems, identities: this.tooltipIds, coordinates: [x, y], isTouchEvent: false });
    }

    private builtInTooltip(): boolean {
        return choice(this.settings.tooltip.style) === "builtin";
    }

    /**
     * Follows the pointer, at most once per frame. move() re-renders the tooltip from the items it is
     * given, so it must get the current items (passing none blanked the tooltip after one move).
     */
    private moveTooltip(event: MouseEvent): void {
        if (!this.hovered) {
            return;
        }
        this.tooltipMove = event;
        if (!this.tooltipFrame) {
            this.tooltipFrame = requestAnimationFrame(() => {
                this.tooltipFrame = 0;
                if (!this.hovered || !this.tooltipMove) {
                    return;
                }
                const [x, y] = pointer(this.tooltipMove, this.root);
                if (this.builtInTooltip()) {
                    this.richTip.move(x, y);
                }
                else {
                    this.host.tooltipService.move({ dataItems: this.tooltipItems, identities: this.tooltipIds, coordinates: [x, y], isTouchEvent: false });
                }
            });
        }
    }

    private hideTooltip(): void {
        this.richTip.hide();
        if (this.tooltipItems.length) {
            this.tooltipItems = [];
            this.host.tooltipService.hide({ isTouchEvent: false, immediately: true });
        }
    }

    private applyInteractivity(): void {
        const allow = this.host.hostCapabilities.allowInteractions !== false;
        const panZoom = allow && this.settings.map.panZoom.value;
        this.svg.style.pointerEvents = allow ? "all" : "none";
        this.zoomBehavior.filter(e => panZoom && (!e.ctrlKey || e.type === "wheel") && !e.button);
        this.zoomBar.style.display = panZoom ? "" : "none";
    }
}

/** Cheap fingerprint of the routes, so unchanged data doesn't trigger a rebuild or a refit. */
function dataSignature(data: ParsedData): string {
    let h = 2166136261;
    const mix = (s: string) => {
        for (let i = 0; i < s.length; i++) {
            h = Math.imul(h ^ s.charCodeAt(i), 16777619);
        }
    };
    for (const r of data.routes) {
        mix(r.origin.key);
        mix(r.destination.key);
        mix(String(r.volume));
        mix(String(r.group));
        mix(r.canal || "");
    }
    return data.routes.length + ":" + (h >>> 0).toString(36);
}
