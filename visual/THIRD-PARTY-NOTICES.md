# Third-party notices

Maritime Flow Map bundles the following code and data. License texts are in `LICENSES/`.

| Component | Used for | License |
|---|---|---|
| **PowerBI-Flowmap** by Weiwei Cui (`src/engine/algo.ts`, `src/engine/arc.ts`) | Bundled flow layout and great-circle arcs | MIT, © 2017 Weiwei Cui ([LICENSES/PowerBI-Flowmap-MIT.txt](LICENSES/PowerBI-Flowmap-MIT.txt)). `arc.ts` is itself adapted from springmeyer/arc.js (BSD) |
| **Natural Earth** (`src/geo/countries-*.json`) | Coastlines, countries, borders | Public domain ([naturalearthdata.com](https://www.naturalearthdata.com)) |
| **world-atlas** 2.0.2 by Mike Bostock | TopoJSON packaging of Natural Earth | ISC ([LICENSES/world-atlas-ISC.txt](LICENSES/world-atlas-ISC.txt)) |
| **us-atlas** 3.0.1 by Mike Bostock (`src/geo/us-states-10m.json`) | US state lines (US Census Bureau, public domain) | ISC |
| **Global Shipping Lane Network**, Oak Ridge National Laboratory, with **Eurostat SeaRoute** additions (`src/geo/marnet.json`) | Sea lanes for the Maritime style | Network as packaged by [searoute-py](https://github.com/genthalili/searoute-py), Apache-2.0 ([LICENSES/searoute-py-Apache-2.0.txt](LICENSES/searoute-py-Apache-2.0.txt)). Eurostat SeaRoute: © European Union (EUPL-1.2 code) |
| **d3** 7.9.0 (selection, zoom, geo, scale, shape, transition, array) | Rendering, projection, zoom | ISC, © Mike Bostock |
| **topojson-client** 3.1.0 | Decoding TopoJSON | ISC, © Mike Bostock |
| **powerbi-visuals-api / -utils-formattingmodel / -utils-formattingutils** | Power BI integration | MIT, © Microsoft |

Maritime routes are indicative routes over the sea-lane network, not vessel tracks.
