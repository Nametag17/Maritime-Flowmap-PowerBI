"use strict";

import { TipModel, TipRow } from "./tooltip";
import { appendSummary, div } from "./richTooltip";

export interface PinHandlers {
    /** Routes to highlight: the hovered row, else the checked rows; null means the whole pinned set. */
    highlight(ids: Set<number> | null): void;
    /** The card was closed (× or Escape). */
    close(): void;
}

/**
 * The details card a click pins to the map, for exploring long route lists and for screenshots.
 * Search the routes, hover a row to light that route up against the rest, check rows to keep them
 * highlighted, and "Checked only" to trim the card to them while the map still draws everything.
 * "+N more" expands the list in place. Drag the card anywhere; × or Escape closes it.
 */
export class PinnedCard {
    private el: HTMLDivElement;
    private rows: TipRow[] = [];
    private checked = new Set<number>();
    private query = "";
    private expanded = false;
    private checkedOnly = false;
    private visibleRows = 6;
    private list: HTMLDivElement | null = null;
    private search: HTMLInputElement | null = null;
    private only: HTMLButtonElement | null = null;
    private hint: HTMLDivElement | null = null;
    private pos = { left: 0, top: 0 };
    public open = false;

    constructor(private container: HTMLElement, private handlers: PinHandlers) {
        this.el = div("wfm-tip wfm-pin");
        this.el.style.display = "none";
        this.el.setAttribute("role", "dialog");
        this.el.setAttribute("aria-label", "Pinned details");
        container.appendChild(this.el);
        this.el.addEventListener("keydown", e => {
            if (e.key === "Escape") {
                this.handlers.close();
            }
            e.stopPropagation(); // typing in the search box is not a report shortcut
        });
        this.enableDrag();
    }

    public show(m: TipModel, theme: "light" | "dark", fontSize: number, x: number, y: number, visibleRows: number): void {
        this.el.className = "wfm-tip wfm-pin wfm-tip-" + theme;
        this.el.style.fontSize = fontSize + "px";
        this.el.replaceChildren();
        this.rows = m.rows.filter(r => r.routeId !== undefined);
        this.checked.clear();
        this.query = "";
        this.expanded = false;
        this.checkedOnly = false;
        this.visibleRows = Math.max(1, visibleRows);
        this.list = this.search = this.only = this.hint = null;

        const close = document.createElement("button");
        close.type = "button";
        close.className = "wfm-pin-close";
        close.textContent = "×";
        close.title = "Close (Esc)";
        close.setAttribute("aria-label", "Close");
        close.addEventListener("click", () => this.handlers.close());
        this.el.append(close);
        appendSummary(this.el, m);

        if (this.rows.length > 1) {
            const tools = div("wfm-pin-tools");
            this.search = document.createElement("input");
            this.search.type = "search";
            this.search.className = "wfm-pin-search";
            this.search.placeholder = "Search " + this.rows.length + " routes";
            this.search.setAttribute("aria-label", "Search routes");
            this.search.addEventListener("input", () => {
                this.query = this.search.value.trim().toLowerCase();
                this.renderRows();
            });
            this.only = document.createElement("button");
            this.only.type = "button";
            this.only.className = "wfm-pin-only";
            this.only.addEventListener("click", () => {
                this.checkedOnly = !this.checkedOnly;
                this.renderRows();
            });
            tools.append(this.search, this.only);
            this.el.append(tools);
        }
        if (this.rows.length) {
            this.list = div("wfm-pin-rows");
            this.list.style.maxHeight = Math.max(80, Math.round(this.container.clientHeight * 0.45)) + "px";
            this.list.addEventListener("mouseleave", () => this.emit());
            this.el.append(this.list);
        }
        for (const n of m.notes.filter(x => !x.hint)) {
            this.el.append(div("wfm-tip-note" + (n.warn ? " wfm-tip-warn" : ""), n.text));
        }
        if (this.rows.length > 1) {
            this.hint = div("wfm-tip-note wfm-pin-hint", "Check routes to highlight them · drag to move · × to close");
            this.el.append(this.hint);
        }
        this.el.style.display = "";
        this.open = true;
        this.renderRows();

        // Next to the click, flipped and clamped like the hover card.
        const W = this.container.clientWidth, H = this.container.clientHeight, w = this.el.offsetWidth, h = this.el.offsetHeight, gap = 14;
        this.setPos(x + gap + w > W - 4 ? x - gap - w : x + gap, y + gap + h > H - 4 ? y - gap - h : y + gap);
    }

    public hide(): void {
        if (this.open) {
            this.el.style.display = "none";
            this.open = false;
            this.rows = [];
        }
    }

    /** Keeps the card inside the visual after a resize or a change in its size. */
    public clamp(): void {
        if (this.open) {
            this.setPos(this.pos.left, this.pos.top);
        }
    }

    private renderRows(): void {
        if (!this.list) {
            return;
        }
        const all = this.checkedOnly ? this.rows.filter(r => this.checked.has(r.routeId))
            : this.rows.filter(r => !this.query || r.search.includes(this.query) || r.label.toLowerCase().includes(this.query));
        const limit = this.checkedOnly || this.query || this.expanded ? all.length : this.visibleRows;
        const shown = all.slice(0, limit);
        this.list.replaceChildren();
        for (const r of shown) {
            this.list.append(this.rowEl(r));
        }
        if (all.length > shown.length) {
            this.list.append(this.link("+" + (all.length - shown.length) + " more ▾", () => { this.expanded = true; this.renderRows(); }));
        }
        else if (this.expanded && !this.query && !this.checkedOnly && this.rows.length > this.visibleRows) {
            this.list.append(this.link("Show fewer ▴", () => { this.expanded = false; this.renderRows(); }));
        }
        if (!shown.length) {
            this.list.append(div("wfm-pin-empty", this.checkedOnly ? "No routes checked" : "No routes match"));
        }
        if (this.search) {
            this.search.style.display = this.checkedOnly ? "none" : "";
        }
        if (this.hint) {
            this.hint.style.display = this.checkedOnly ? "none" : ""; // "Checked only" is the screenshot view
        }
        this.updateOnly();
        this.clamp();
    }

    private rowEl(r: TipRow): HTMLDivElement {
        const row = div("wfm-pin-row");
        const box = div("wfm-pin-check");
        row.append(box, div("wfm-tip-row-label", r.label), div("wfm-tip-row-value", r.value));
        row.setAttribute("role", "checkbox");
        row.tabIndex = 0;
        const paint = () => {
            const on = this.checked.has(r.routeId);
            row.classList.toggle("wfm-on", on);
            row.setAttribute("aria-checked", String(on));
            box.style.borderColor = r.color || "";
            box.style.background = on ? r.color || "currentColor" : "";
        };
        const toggle = () => {
            if (!this.checked.delete(r.routeId)) {
                this.checked.add(r.routeId);
            }
            paint(); // in place: re-rendering would reset the list's scroll position
            this.updateOnly();
            if (this.checkedOnly && !this.checked.size) {
                this.checkedOnly = false;
                this.renderRows();
            }
            this.handlers.highlight(new Set([r.routeId]));
        };
        paint();
        row.addEventListener("mouseenter", () => this.handlers.highlight(new Set([r.routeId])));
        row.addEventListener("click", toggle);
        row.addEventListener("keydown", e => {
            if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                toggle();
            }
        });
        return row;
    }

    private link(text: string, action: () => void): HTMLDivElement {
        const d = div("wfm-pin-row wfm-pin-more", text);
        d.tabIndex = 0;
        d.addEventListener("click", action);
        d.addEventListener("keydown", e => {
            if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                action();
            }
        });
        return d;
    }

    private updateOnly(): void {
        if (this.only) {
            this.only.textContent = this.checkedOnly ? "Show all " + this.rows.length : "Checked only (" + this.checked.size + ")";
            this.only.disabled = !this.checkedOnly && !this.checked.size;
        }
    }

    /** The map shows the checked routes, or the whole pinned set when none is checked. */
    private emit(): void {
        this.handlers.highlight(this.checked.size ? new Set(this.checked) : null);
    }

    private setPos(left: number, top: number): void {
        const W = this.container.clientWidth, H = this.container.clientHeight;
        this.pos.left = Math.max(4, Math.min(left, W - this.el.offsetWidth - 4));
        this.pos.top = Math.max(4, Math.min(top, H - this.el.offsetHeight - 4));
        this.el.style.transform = `translate(${Math.round(this.pos.left)}px, ${Math.round(this.pos.top)}px)`;
    }

    /** Drag by any part that isn't a control or the route list. */
    private enableDrag(): void {
        let start: { x: number; y: number; left: number; top: number } | null = null;
        this.el.addEventListener("pointerdown", e => {
            const t = e.target as HTMLElement;
            if (e.button !== 0 || t.closest("button, input, .wfm-pin-rows")) {
                return;
            }
            start = { x: e.clientX, y: e.clientY, left: this.pos.left, top: this.pos.top };
            this.el.setPointerCapture(e.pointerId);
            this.el.classList.add("wfm-dragging");
        });
        this.el.addEventListener("pointermove", e => {
            if (start) {
                this.setPos(start.left + e.clientX - start.x, start.top + e.clientY - start.y);
            }
        });
        const end = () => {
            start = null;
            this.el.classList.remove("wfm-dragging");
        };
        this.el.addEventListener("pointerup", end);
        this.el.addEventListener("pointercancel", end);
    }
}
