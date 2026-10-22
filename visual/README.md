# Maritime Flow Map

A Power BI custom visual for seaborne cargo flows. It draws routes between terminals as bundled
curves, great circles, curves, straight lines or **indicative sea routes** on a built-in map, with no
map service, API key or network access.

Successor to [weiweicui/PowerBI-Flowmap](https://github.com/weiweicui/PowerBI-Flowmap), whose
flow layout engine it reuses (see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)). That visual
stopped working when Bing Maps keys were retired.

## Fields

| Well | What to put in | Required |
|---|---|---|
| Origin / Destination | Terminal or port name (labels, tooltips) | yes |
| Origin latitude / longitude, Destination latitude / longitude | Decimal degrees, as number columns (text holding a number also works). Nothing is geocoded | yes |
| Volume | Measure; sets line width. Shown in the measure's own format | recommended |
| Color by | Category, e.g. product; each value gets its own color in the Format pane | no |
| Canal transit | List of canals/straits passed (e.g. Kpler "Zone Canal Transit"); the Maritime style routes through them | no |
| Tooltips | Extra measures shown on hover | no |

If a source has one combined "lat, lon" column, split it in Power Query (Split Column → By delimiter → comma).
Rows without usable coordinates are counted in the legend rather than silently dropped.

## Format pane

Flow style · Maritime routes · Chokepoints · Lines · Colors by category · Terminals · Terminal labels · Map · Tooltip · Legend.
The Tooltip card switches between the built-in card and Power BI's tooltip; the latter also supports
report page tooltips, filtered to the hovered routes.

**Chokepoints** marks the Panama Canal, Suez Canal, Bab El Mandeb, Strait of Hormuz and Cape of Good
Hope (all, the two canals, or Panama only), labelled with the volume through each. With the Canal
transit field bound, the volume counts the *recorded* transits, the same rule as a chokepoint filter
(a route counts under every chokepoint it passed), so the map agrees with the report's filters.
Without it, the Maritime style uses the drawn sea routes; other styles only mark the locations.
Hovering a chokepoint highlights its routes; clicking it filters the page to them.

Clicking a flow, terminal or chokepoint cross-filters the other visuals on the page; right-click opens
the Power BI context menu.

The zoom bar (bottom right) has zoom in, zoom out and **⌂ fit**: it zooms to the trades on the map, or
to the selection when a flow, terminal or chokepoint is selected. With "Fit to data when it changes" on,
the map also refits whenever filters change. For a bigger map use Power BI's **Focus mode** (the visual
header's expand icon) or View › Full screen; a custom visual cannot go fullscreen itself.

**Maritime routing:** routes go through every recorded transit and avoid tracked chokepoints that
weren't recorded. When a record is inconsistent (e.g. Bab El Mandeb without Suez), the route keeps the
recorded passages and may also use unrecorded ones (the tooltip says so). Records that still can't be
followed sensibly fall back to the shortest route, flagged in the tooltip. Bind the Canal transit field:
without it every route takes the shortest path, which for e.g. US East Coast → Southeast Asia is via
Suez, not Panama.

## Build

Use Git Bash, since pbiviz 6's certificate step fails from PowerShell 7:

```bash
npm ci
npm run package          # → dist/waterborneFlowMap997D23A5C88441438E3380877E4855D8.<version>.pbiviz
npx tsc --noEmit -p . && npx eslint src
```

Toolchain: powerbi-visuals-tools 6.2.0 (works on Node 18), API 5.11. Keep
`powerbi-visuals-utils-formattingutils` at 6.1.2: 7.x needs pbiviz 7. **Never change the GUID**
in `pbiviz.json`; reports bind the visual by it.

## Test harness

`harness/index.html` runs the packaged build (`.tmp/drop/visual.js`) in a browser with a stand-in
Power BI host. Its datasets (`harness/data/`) are generated from licensed data and are git-ignored.
URL parameters: `data=…`, `color=product`, `canal=1`, `o.<card>.<property>=<value>`, `hover=1`, `click=1`.

## Known limitations

- First render in the Maritime style computes routes on the main thread: about 1–1.5 s for 500–750
  routes. Routes are cached afterwards, also across filter changes.
- The built-in tooltip stays inside the visual's frame; long lists end with "+N more".
- Up to 30,000 category rows per query (Power BI data reduction).
