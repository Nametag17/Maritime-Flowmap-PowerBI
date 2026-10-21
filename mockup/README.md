# Flow map design mockup

A browser mockup used to agree on the look and behavior of the new flow map visual
before building it for Power BI. Open `index.html` directly in a browser; no server
or install is needed.

- The map frame in the middle is the visual itself.
- The navy cards around it stand in for the dashboard tables and for Power BI's Format pane.
- Settings are remembered per browser and can be set by URL, e.g.
  `index.html?style=arc&theme=light&z=7&center=-94.8,29.6` (`z` is a Bing-style zoom level).

## Files

| Path | What |
|---|---|
| `index.html`, `style.css`, `app.js` | The mockup |
| `vendor/flowmap-engine.js` | The original Flowmap layout code (`code/src/lava/flowmap/algo.ts` and `arc.ts`), bundled unchanged |
| `vendor/d3.v7.9.0.min.js`, `vendor/topojson-client.v3.1.0.min.js` | d3 and topojson-client (ISC) |
| `data/world-50m.js`, `data/world-10m.js` | Natural Earth countries (public domain) via world-atlas 2.0.2 |
| `data/us-states.js` | US states via us-atlas 3.0.1 |
| `data/marnet.js` | Sea-lane network for the Maritime style: Oak Ridge National Laboratory Global Shipping Lane Network + Eurostat SeaRoute additions, via searoute-py (Apache-2.0) |
| `data/sample-*.js` | Samples: `sample-flows.js` (Caribbean, from `../data.csv`), `sample-us-2025.js`, `sample-me-2025.js` (from the raw Kpler table). **Licensed Kpler data: git-ignored locally, never commit** |
| `tools/build-data.mjs` | Converts the CSVs and TopoJSON into the script files above |
| `tools/engine-entry.ts` | Entry point for bundling the original engine |

## Regenerate

From `mockup/tools`:

```bash
node build-data.mjs flows ../../data.csv ../data/sample-flows.js
# Kpler samples: raw trades table + coordinates exported from the model (see NGL_DB_Dev/tools)
node build-data.mjs kpler <NGL_DB_Dev>/data/raw/trades_<stamp>.csv <NGL_DB_Dev>/data/geocode/locations_from_model_<date>.csv \
  ../data/sample-us-2025.js us-2025 "US exports 2025 (Kpler)" "United States" 2025 400
node build-data.mjs wrap <countries-50m.json> ../data/world-50m.js WORLD_50M
node build-data.mjs wrap <searoute-py>/searoute/data/marnet_searoute.geojson ../data/marnet.js MARNET
```

From the repo root, rebuild the engine bundle:

```bash
npx -y esbuild@0.25.0 mockup/tools/engine-entry.ts --bundle --format=iife --global-name=FlowEngine --target=es2017 --legal-comments=inline --outfile=mockup/vendor/flowmap-engine.js
```

## Known quirks

- The original layout engine loops forever if two targets of one origin share the
  exact same coordinates. The mockup merges such targets first; the Power BI visual must too.
- Three 1:10m Maldives polygons are stored inverted and would paint every zoomed-in
  view as land. `rewindInverted()` in `app.js` fixes them on load.
- Headless Edge screenshots taken with `--disable-gpu` leave the basemap canvas blank.
  Real browsers are fine.
- Sea lanes are split at the date line; the graph treats lon +180 and −180 as one node,
  otherwise the Pacific is cut in half. The Arctic passages (`northwest`, `bering`) are always
  blocked, or USGC→Asia routes "shortcut" over Canada.
- Maritime routes are indicative: shortest sea-lane path through every chokepoint Kpler recorded
  in `Zone Canal Transit`, avoiding tracked ones it didn't record. If that is impossible or more
  than 3× the free shortest path (multi-leg voyages), the shortest path is shown and flagged.
- Resizing a canvas clears it; `resize()` redraws immediately so no blank frame shows.
