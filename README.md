# Maritime Flow Map for Power BI

A Power BI custom visual for seaborne cargo flows. It shows where cargo moves from terminal to terminal
as bundled curves, great circles, curves, straight lines, or **indicative sea routes** that follow the
canals and straits recorded in the data (Panama, Suez, Bab-el-Mandeb, Hormuz, Cape of Good Hope).
Everything is drawn on a built-in map from bundled open data, with no map service, API key or network
access, so it can't be switched off from outside the way Bing Maps was.

Built for an NGL / LPG trade dashboard on Kpler data. It works with any table of origin and destination
coordinates and a volume.

## What's in this repository

| Folder | What |
|---|---|
| [`visual/`](visual/) | **The Power BI visual** (TypeScript, pbiviz). Start with [visual/README.md](visual/README.md) for fields, formatting options and build steps |
| [`mockup/`](mockup/) | The HTML design mockup used to agree on the look before building (opens directly in a browser) |
| `code/`, `dist/`, `docs/` | The original [weiweicui/PowerBI-Flowmap](https://github.com/weiweicui/PowerBI-Flowmap) (2017–2020), kept unchanged for reference |

## Highlights

- **Coordinates in, nothing geocoded:** explicit latitude/longitude fields for each end.
- **Maritime style:** routes over the Oak Ridge National Laboratory shipping-lane network. Lanes thicken where routes share them, and tooltips give the sea distance in nautical miles and the chokepoints passed.
- **Bundled style:** the original Flowmap layout engine (one-to-many and many-to-one trees), reused under its MIT license.
- **Power BI integration:** cross-filtering on click, a context menu, Format pane options for every element, a built-in rich tooltip or Power BI's own (including report page tooltips), and high-contrast support.
- **Smooth interaction:** pan and zoom run at 60 fps with hundreds of routes.

## Credits

Based on [PowerBI-Flowmap](https://github.com/weiweicui/PowerBI-Flowmap) by Weiwei Cui (MIT).
Map data: Natural Earth (public domain). Sea lanes: Oak Ridge National Laboratory Global Shipping
Lane Network with Eurostat SeaRoute additions, via searoute-py (Apache-2.0). Full list in
[visual/THIRD-PARTY-NOTICES.md](visual/THIRD-PARTY-NOTICES.md).

Maritime routes are indicative, not vessel tracks.

## License

MIT (see [LICENSE](LICENSE); the original copyright notice is kept as the license requires).
