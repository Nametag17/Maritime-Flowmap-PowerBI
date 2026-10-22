"use strict";

import { TipModel } from "./tooltip";

export function div(cls: string, text?: string): HTMLDivElement {
    const d = document.createElement("div");
    d.className = cls;
    if (text !== undefined) {
        d.textContent = text; // tooltip text is data: never innerHTML
    }
    return d;
}

/** The card's top part, shared with the pinned card: the number, what it is, the title, sub-lines and facts. */
export function appendSummary(el: HTMLElement, m: TipModel): void {
    const head = div("wfm-tip-value", m.value);
    head.append(div("wfm-tip-caption", m.caption));
    const title = div("wfm-tip-title");
    if (m.color) {
        const key = div("wfm-tip-key");
        key.style.background = m.color;
        title.append(key);
    }
    title.append(div("", m.title));
    el.append(head, title);
    for (const s of m.subs) {
        el.append(div("wfm-tip-sub", s.text));
    }
    if (m.facts.length) {
        const facts = div("wfm-tip-facts");
        for (const f of m.facts) {
            facts.append(div("wfm-tip-fact-label", f.label), div("wfm-tip-fact-value", f.value));
        }
        el.append(facts);
    }
}

/**
 * The built-in tooltip card (the mockup's design): the number leads, then what it is, then the
 * routes with their volumes. Drawn inside the visual, so it is kept within the visual's bounds: it
 * flips to the other side of the pointer near an edge.
 */
export class RichTooltip {
    private el: HTMLDivElement;
    private visible = false;

    constructor(private container: HTMLElement) {
        this.el = div("wfm-tip");
        this.el.setAttribute("role", "tooltip");
        this.el.style.display = "none";
        container.appendChild(this.el);
    }

    public show(m: TipModel, theme: "light" | "dark", fontSize: number, x: number, y: number): void {
        this.el.className = "wfm-tip wfm-tip-" + theme;
        this.el.style.fontSize = fontSize + "px";
        this.el.replaceChildren();
        appendSummary(this.el, m);

        if (m.rows.length) {
            // Route, then its volume as the bold number on the row (Angel preferred this to share bars).
            const rows = div("wfm-tip-rows");
            for (const r of m.rows.concat(m.more ? [m.more] : [])) {
                const more = r === m.more ? " wfm-tip-more" : "";
                rows.append(div("wfm-tip-row-label" + more, r.label), div("wfm-tip-row-value" + more, r.value));
            }
            this.el.append(rows);
        }

        for (const n of m.notes) {
            this.el.append(div("wfm-tip-note" + (n.warn ? " wfm-tip-warn" : ""), n.text));
        }

        this.el.style.display = "";
        this.visible = true;
        this.move(x, y);
    }

    /** Places the card next to the pointer, flipped and clamped to stay inside the visual. */
    public move(x: number, y: number): void {
        if (!this.visible) {
            return;
        }
        const W = this.container.clientWidth, H = this.container.clientHeight;
        const tw = this.el.offsetWidth, th = this.el.offsetHeight, gap = 14;
        let left = x + gap, top = y + gap;
        if (left + tw > W - 4) left = x - gap - tw;
        if (top + th > H - 4) top = y - gap - th;
        left = Math.max(4, Math.min(left, W - tw - 4));
        top = Math.max(4, Math.min(top, H - th - 4));
        this.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    }

    public hide(): void {
        if (this.visible) {
            this.el.style.display = "none";
            this.visible = false;
        }
    }
}
