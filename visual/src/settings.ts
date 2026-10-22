"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import ValidatorType = powerbi.visuals.ValidatorType;
import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

// Every option the HTML mockup exposed, plus parity with weiweicui's original Format pane (bundle
// limit, width scale, per-category colors, bubble sizing). Each card's name/property names must
// match capabilities.json "objects".

type Item = powerbi.IEnumMember;
const item = (value: string, displayName: string): Item => ({ value, displayName });

function dropdown(name: string, displayName: string, items: Item[], value: string): formattingSettings.ItemDropdown {
    return new formattingSettings.ItemDropdown({ name, displayName, items, value: items.find(i => i.value === value) });
}

function number(name: string, displayName: string, value: number, min: number, max: number): formattingSettings.NumUpDown {
    return new formattingSettings.NumUpDown({
        name, displayName, value,
        options: { minValue: { type: ValidatorType.Min, value: min }, maxValue: { type: ValidatorType.Max, value: max } }
    });
}

function slider(name: string, displayName: string, value: number, min: number, max: number): formattingSettings.Slider {
    return new formattingSettings.Slider({
        name, displayName, value,
        options: { minValue: { type: ValidatorType.Min, value: min }, maxValue: { type: ValidatorType.Max, value: max } }
    });
}

const toggle = (name: string, displayName: string, value: boolean) => new formattingSettings.ToggleSwitch({ name, displayName, value });
const color = (name: string, displayName: string, value: string) => new formattingSettings.ColorPicker({ name, displayName, value: { value } });

export const STYLE_ITEMS = [
    item("bundled", "Bundled"), item("maritime", "Maritime (sea routes)"), item("arc", "Great circle"), item("curved", "Curved"), item("straight", "Straight")
];

class FlowStyleCard extends FormattingSettingsCard {
    style = dropdown("style", "Style", STYLE_ITEMS, "bundled");
    bundleFrom = dropdown("bundleFrom", "Bundle from", [item("origin", "Origin"), item("destination", "Destination")], "origin");
    flowLimit = number("flowLimit", "Bundle limit (0 = all)", 0, 0, 1000);
    curvature = slider("curvature", "Curvature (%)", 22, 0, 60);
    motion = toggle("motion", "Animate direction", false);

    name = "flowStyle";
    displayName = "Flow style";
    slices: FormattingSettingsSlice[] = [this.style, this.bundleFrom, this.flowLimit, this.curvature, this.motion];
}

/** Maritime style: indicative sea routes over the sea-lane network. */
class MaritimeCard extends FormattingSettingsCard {
    follow = toggle("follow", "Follow recorded canal / strait transits", true);
    blockArctic = toggle("blockArctic", "Avoid Arctic passages", true);
    approaches = toggle("approaches", "Show port approaches", true);
    smooth = toggle("smooth", "Smooth lanes", true);

    name = "maritime";
    displayName = "Maritime routes";
    slices: FormattingSettingsSlice[] = [this.follow, this.blockArctic, this.approaches, this.smooth];
}

/** Markers for the chokepoints Kpler tracks, with the volume through each (any flow style). */
class ChokepointsCard extends FormattingSettingsCard {
    show = toggle("show", "Show chokepoints", true);
    which = dropdown("which", "Chokepoints", [
        item("all", "All tracked (canals, straits, Cape)"), item("canals", "Panama and Suez canals"), item("panama", "Panama Canal only")
    ], "all");
    onlyActive = toggle("onlyActive", "Only those with flows on the map", true);
    label = dropdown("label", "Label", [item("both", "Name and volume"), item("name", "Name"), item("off", "Off")], "both");
    color = color("color", "Marker color", "#f2b134");

    name = "chokepoints";
    displayName = "Chokepoints";
    slices: FormattingSettingsSlice[] = [this.show, this.which, this.onlyActive, this.label, this.color];
}

class LinesCard extends FormattingSettingsCard {
    color = color("color", "Color", "#e66c37");
    minWidth = number("minWidth", "Minimum width", 2, 0.5, 20);
    maxWidth = number("maxWidth", "Maximum width", 10, 1, 40);
    widthScale = dropdown("widthScale", "Width scale", [item("linear", "Linear"), item("compressed", "Compressed")], "linear");
    opacity = slider("opacity", "Opacity (%)", 100, 10, 100);

    name = "lines";
    displayName = "Lines";
    slices: FormattingSettingsSlice[] = [this.color, this.minWidth, this.maxWidth, this.widthScale, this.opacity];
}

/** One color per "Color by" category; slices are added at update time from the data. */
export class ColorsCard extends FormattingSettingsCard {
    name = "colors";
    displayName = "Colors by category";
    slices: FormattingSettingsSlice[] = [];
}

class TerminalsCard extends FormattingSettingsCard {
    show = dropdown("show", "Show as", [item("bubbles", "Bubbles sized by volume"), item("dots", "Dots"), item("off", "Off")], "bubbles");
    bubbleMax = number("bubbleMax", "Largest bubble (px)", 15, 4, 50);
    destinationColor = color("destinationColor", "Destination color", "");

    name = "terminals";
    displayName = "Terminals";
    slices: FormattingSettingsSlice[] = [this.show, this.bubbleMax, this.destinationColor];
}

class LabelsCard extends FormattingSettingsCard {
    show = dropdown("show", "Show for", [item("all", "All terminals"), item("origins", "Origins"), item("destinations", "Destinations"), item("off", "Off")], "all");
    shortNames = toggle("shortNames", "Short names (text before the first comma)", true);
    fontSize = number("fontSize", "Text size", 11, 7, 24);
    density = slider("density", "Label density", 10, 1, 40);
    color = color("color", "Color", "");

    name = "labels";
    displayName = "Terminal labels";
    slices: FormattingSettingsSlice[] = [this.show, this.shortNames, this.fontSize, this.density, this.color];
}

class MapCard extends FormattingSettingsCard {
    theme = dropdown("theme", "Theme", [item("navy", "Navy"), item("midnight", "Midnight"), item("light", "Light")], "navy");
    ocean = color("ocean", "Water color", "");
    land = color("land", "Land color", "");
    borders = color("borders", "Border color", "");
    countryLabels = toggle("countryLabels", "Country labels", true);
    seaLabels = toggle("seaLabels", "Sea labels", true);
    usStates = toggle("usStates", "US state lines", true);
    panZoom = toggle("panZoom", "Pan and zoom", true);
    autoFit = toggle("autoFit", "Fit to data when it changes", true);

    name = "map";
    displayName = "Map";
    slices: FormattingSettingsSlice[] = [this.theme, this.ocean, this.land, this.borders, this.countryLabels, this.seaLabels, this.usStates, this.panZoom, this.autoFit];
}

/** Hover details: the built-in card, or Power BI's own tooltip (which also allows report page tooltips). */
class TooltipCard extends FormattingSettingsCard {
    style = dropdown("style", "Style", [item("builtin", "Built-in card"), item("powerbi", "Power BI tooltip (allows report page tooltips)")], "builtin");
    theme = dropdown("theme", "Card theme", [item("light", "Light"), item("dark", "Dark")], "light");
    fontSize = number("fontSize", "Text size", 12, 9, 18);
    maxRows = number("maxRows", "Routes listed", 6, 1, 20);
    shortNames = toggle("shortNames", "Short terminal names", true);
    pinOnClick = toggle("pinOnClick", "Pin details on click (search, check routes)", true);

    name = "richTooltip";
    displayName = "Tooltip";
    slices: FormattingSettingsSlice[] = [this.style, this.theme, this.fontSize, this.maxRows, this.shortNames, this.pinOnClick];
}

class LegendCard extends FormattingSettingsCard {
    show = toggle("show", "Show", true);
    position = dropdown("position", "Position", [item("topLeft", "Top left"), item("bottomLeft", "Bottom left")], "topLeft");
    fontSize = number("fontSize", "Text size", 11, 7, 20);

    name = "legend";
    displayName = "Legend";
    slices: FormattingSettingsSlice[] = [this.show, this.position, this.fontSize];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    flowStyle = new FlowStyleCard();
    maritime = new MaritimeCard();
    chokepoints = new ChokepointsCard();
    lines = new LinesCard();
    colors = new ColorsCard();
    terminals = new TerminalsCard();
    labels = new LabelsCard();
    map = new MapCard();
    tooltip = new TooltipCard();
    legend = new LegendCard();

    cards: FormattingSettingsCard[] = [this.flowStyle, this.maritime, this.chokepoints, this.lines, this.colors, this.terminals, this.labels, this.map, this.tooltip, this.legend];
}

/** Value of a dropdown slice as its string key. */
export function choice<T extends string>(d: formattingSettings.ItemDropdown): T {
    return (d.value ? d.value.value : d.items[0].value) as T;
}

/** A color slice's value, or the fallback when it was left empty. */
export function colorOr(c: formattingSettings.ColorPicker, fallback: string): string {
    return c.value && c.value.value ? c.value.value : fallback;
}
