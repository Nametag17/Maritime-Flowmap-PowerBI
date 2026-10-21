/* Flow map design mockup, v0.1.
 *
 * Everything drawn inside #visual is what the Power BI visual would render. The navy cards
 * around it stand in for the dashboard (origin / destination tables) and for Power BI's
 * Format pane (the design controls), so styling and cross-filtering can be judged in context.
 *
 * Curves:    the original Flowmap layout engine (vendor/flowmap-engine.js, MIT © Weiwei Cui), unchanged.
 * Basemap:   Natural Earth (public domain), drawn with d3-geo on a canvas. No tiles, no keys, no network.
 * Sea lanes: ORNL Global Shipping Lane Network + Eurostat SeaRoute, via searoute-py (data/marnet.js).
 */
(function () {
  'use strict';

  const WORLD = 256;              // Web Mercator world size in px at k = 1 (Bing zoom level 0)
  const LEVEL20 = 2 ** 20;        // the original engine lays flows out at Bing zoom level 20
  const MAX_LAT = 85.05112878;
  const HI_RES_FROM_K = 24;       // ≈ Bing zoom 4.6: switch from 1:50m to 1:10m coastlines
  const MAX_K = 2 ** 11;          // past ≈ Bing zoom 11 the 1:10m coastline only gets blockier
  const STORAGE_KEY = 'flowmap-mockup-v1';
  const FONT = '"Segoe UI", system-ui, -apple-system, sans-serif';
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Flow colors validated with the dataviz palette checker against each theme's land and ocean
  // (all-pairs, because on a map any two flows can sit side by side).
  const THEMES = {
    navy: {
      ocean: '#041d45', land: '#0d3270', coast: '#2c5aa0', border: '#5277b8', state: '#23508f',
      countryLabel: '#8c9cb5', seaLabel: '#5a80bd',
      text: '#f4faff', textMuted: '#8c9cb5', halo: '#041d45', casing: '#041d45',
      panel: 'rgba(4, 29, 69, 0.88)', panelBorder: 'rgba(140, 156, 181, 0.35)',
      dest: '#f4faff', other: '#8c9cb5', dash: 'rgba(255, 255, 255, 0.65)',
      series: ['#e66c37', '#1baf7a', '#9085e9']
    },
    midnight: {
      ocean: '#0d1117', land: '#1c232d', coast: '#343f4d', border: '#4a5666', state: '#2b3440',
      countryLabel: '#8b96a3', seaLabel: '#56657a',
      text: '#eef1f5', textMuted: '#8b96a3', halo: '#0d1117', casing: '#0d1117',
      panel: 'rgba(13, 17, 23, 0.88)', panelBorder: 'rgba(139, 150, 163, 0.35)',
      dest: '#eef1f5', other: '#8b96a3', dash: 'rgba(255, 255, 255, 0.65)',
      series: ['#e66c37', '#1baf7a', '#9085e9']
    },
    light: {
      ocean: '#d6e2ee', land: '#f4f4f1', coast: '#a9b8c8', border: '#9fb0c3', state: '#cfd8e2',
      countryLabel: '#5a6b85', seaLabel: '#6f89a8',
      text: '#0b1f3f', textMuted: '#5a6b85', halo: '#f4f4f1', casing: '#ffffff',
      panel: 'rgba(255, 255, 255, 0.92)', panelBorder: 'rgba(11, 31, 63, 0.18)',
      dest: '#0b1f3f', other: '#7c8796', dash: 'rgba(255, 255, 255, 0.9)',
      series: ['#e66c37', '#1baf7a', '#6250d6']
    }
  };

  const SEAS = [
    { name: 'Gulf of Mexico', lon: -90.3, lat: 25.2, minK: 5 },
    { name: 'Caribbean Sea', lon: -75.5, lat: 14.6, minK: 5 },
    { name: 'Sargasso Sea', lon: -64, lat: 27.5, minK: 12 },
    { name: 'Atlantic Ocean', lon: -50, lat: 31, minK: 1, maxK: 40 },
    { name: 'Pacific Ocean', lon: -122, lat: 12, minK: 1, maxK: 40 },
    { name: 'Indian Ocean', lon: 78, lat: -18, minK: 1, maxK: 40 },
    { name: 'Mediterranean Sea', lon: 18, lat: 34.5, minK: 6 },
    { name: 'North Sea', lon: 3.5, lat: 56, minK: 8 }
  ];
  const NAME_FIX = { 'United States of America': 'United States' };

  const WIDTHS = { thin: [1.5, 6], medium: [2, 10], bold: [3, 16] };
  const DEFAULTS = {
    style: 'bundled', bundleBy: 'origin', color: 'single', width: 'medium', widthScale: 'linear',
    terminals: 'bubbles', labels: 'all', theme: 'navy', mapLabels: 'on', motion: 'off', size: 'dashboard'
  };
  const CONTROLS = [
    { key: 'style', label: 'Flow style', options: [['bundled', 'Bundled'], ['arc', 'Great circle'], ['curved', 'Curved'], ['straight', 'Straight'], ['maritime', 'Maritime']] },
    { key: 'bundleBy', label: 'Bundle from', options: [['origin', 'Origin'], ['destination', 'Destination']], when: s => s.style === 'bundled' },
    { key: 'color', label: 'Color', options: [['single', 'Single'], ['origin', 'By origin'], ['destCountry', 'By dest. country']] },
    { key: 'width', label: 'Line width', options: [['thin', 'Thin'], ['medium', 'Medium'], ['bold', 'Bold']] },
    { key: 'widthScale', label: 'Width scale', options: [['linear', 'Linear'], ['compressed', 'Compressed']] },
    { key: 'terminals', label: 'Terminals', options: [['bubbles', 'Bubbles'], ['dots', 'Dots'], ['off', 'Off']] },
    { key: 'labels', label: 'Terminal labels', options: [['all', 'All'], ['origins', 'Origins'], ['destinations', 'Destinations'], ['off', 'Off']] },
    { key: 'theme', label: 'Map', options: [['navy', 'Navy'], ['midnight', 'Midnight'], ['light', 'Light']] },
    { key: 'mapLabels', label: 'Map labels', options: [['on', 'On'], ['off', 'Off']] },
    { key: 'motion', label: 'Direction', options: [['off', 'Static'], ['dashes', 'Flowing dashes']] },
    { key: 'size', label: 'Panel', options: [['dashboard', 'Dashboard size'], ['large', 'Large']] }
  ];

  const $ = id => document.getElementById(id);
  const visualEl = $('visual'), svgEl = $('overlay'), canvas = $('basemap'), tipEl = $('tooltip'), legendEl = $('legend');
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const fmt = d3.format(',.0f');

  // Samples register themselves in window.SAMPLES (see tools/build-data.mjs). They are licensed
  // data and git-ignored, so a fresh clone has none.
  const SAMPLES = window.SAMPLES || {};
  if (!Object.keys(SAMPLES).length) {
    const msg = document.createElement('div');
    msg.className = 'empty';
    msg.textContent = 'No sample data found. Run: node tools/build-data.mjs flows ../data.csv data/sample-flows.js';
    visualEl.append(msg);
    return;
  }
  CONTROLS.unshift({ key: 'sample', label: 'Sample', options: Object.entries(SAMPLES).map(([id, s]) => [id, s.title || id]) });
  DEFAULTS.sample = SAMPLES.caribbean ? 'caribbean' : Object.keys(SAMPLES)[0];

  // ---------------------------------------------------------------- state

  // Settings: defaults < last saved < URL (e.g. ?style=arc&theme=light&z=7&center=-94.8,29.6),
  // so a specific design can be shared as a link.
  const params = new URLSearchParams(location.search);
  const state = Object.assign({}, DEFAULTS, validSettings(loadSaved()), validSettings(Object.fromEntries(params)));
  const view = {
    W: 0, H: 0, dpr: 1, kMin: 1, t: d3.zoomIdentity, zooming: false, ready: false,
    hover: null, selection: null, tableFilter: null, legendCollapsed: false
  };

  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (e) { return {}; }
  }

  function validSettings(input) {
    const valid = {};
    for (const c of CONTROLS) {
      if (c.options.some(o => o[0] === input[c.key])) valid[c.key] = input[c.key];
    }
    return valid;
  }

  function initialView() {
    // ?z= is a Bing-style zoom level (k = 2^z); ?center=lon,lat
    const z = parseFloat(params.get('z')), center = (params.get('center') || '').split(',').map(parseFloat);
    if (!isFinite(z) || center.length !== 2 || !center.every(isFinite)) return null;
    const k = Math.max(view.kMin, Math.min(MAX_K, 2 ** z));
    return d3.zoomIdentity.translate(view.W / 2 - k * baseX(center[0]), view.H / 2 - k * baseY(center[1])).scale(k);
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* private mode: fine */ }
  }

  // ---------------------------------------------------------------- projection helpers

  const clampLat = lat => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const baseX = lon => (lon + 180) / 360 * WORLD;
  const baseY = lat => {
    const s = Math.sin(clampLat(lat) * Math.PI / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD;
  };
  const sx = bx => view.t.x + view.t.k * bx;
  const sy = by => view.t.y + view.t.k * by;

  function projection() {
    const { t, W, H } = view;
    return d3.geoMercator()
      .scale(t.k * WORLD / (2 * Math.PI))
      .translate([t.x + t.k * WORLD / 2, t.y + t.k * WORLD / 2])
      .clipExtent([[-2, -2], [W + 2, H + 2]]);
  }

  // ---------------------------------------------------------------- data

  function splitLabel(label) {
    // "First Installation, Port, Country" -> parts; shorter labels drop the middle parts.
    const parts = String(label).split(',').map(s => s.trim()).filter(Boolean);
    const name = parts[0] || String(label);
    const country = parts.length > 1 ? parts[parts.length - 1] : '';
    const port = parts.length > 2 ? parts.slice(1, -1).join(', ') : '';
    return { name, port: port === name ? '' : port, country };
  }

  function buildData(src) {
    const byKey = new Map(), byPair = new Map(), links = [];
    const terminal = (label, lat, lon) => {
      const key = label + '@' + lat.toFixed(5) + ',' + lon.toFixed(5);
      let t = byKey.get(key);
      if (!t) {
        t = Object.assign({ key, label, lat, lon, bx: baseX(lon), by: baseY(lat) }, splitLabel(label));
        byKey.set(key, t);
      }
      return t;
    };
    // Kpler samples add: canal (recorded chokepoints, '' = none), approx (bit 1 origin / bit 2
    // destination located by zone fallback) and trades (number of voyages). Without a canal
    // column the canal is unknown (null), which the maritime style treats differently from ''.
    const hasCanal = (src.columns || []).includes('canal');
    for (const [vol, oLat, oLon, dLat, dLon, oLabel, dLabel, canal, approx, trades] of src.rows) {
      const o = terminal(oLabel, oLat, oLon), d = terminal(dLabel, dLat, dLon);
      if (approx & 1) o.approx = true;
      if (approx & 2) d.approx = true;
      const pair = o.key + '>' + d.key + '>' + (hasCanal ? canal : '');
      let link = byPair.get(pair);
      if (!link) {
        link = { id: links.length, o, d, vol: 0, trades: 0, canal: hasCanal ? canal : null };
        byPair.set(pair, link);
        links.push(link);
      }
      link.vol += vol;
      link.trades += trades || 0;
    }
    return {
      byKey, links, hasCanal,
      title: src.title || 'Sample',
      source: src.source || '',
      unit: src.unit || 'bbls',
      total: d3.sum(links, l => l.vol),
      skipped: src.skipped || 0,
      skippedVolume: src.skippedVolume || 0
    };
  }

  let DATA = buildData(SAMPLES[state.sample]);

  function place(t) {
    return [t.port, t.country].filter(Boolean).join(', ');
  }

  function compact(v) {
    if (v >= 1e6) return d3.format('.3~r')(v / 1e6) + ' MMbbls';
    if (v >= 1e3) return d3.format('.3~r')(v / 1e3) + ' Mbbls';
    return fmt(v) + ' bbls';
  }

  // ---------------------------------------------------------------- geography

  const GEO = { lo: prepGeo(window.WORLD_50M), hi: null, states: null, labels: [] };
  GEO.labels = prepCountryLabels(GEO.lo);
  if (window.US_STATES) {
    GEO.states = topojson.mesh(window.US_STATES, window.US_STATES.objects.states, (a, b) => a !== b);
  }

  function prepGeo(topo) {
    const obj = topo.objects.countries;
    return {
      features: topojson.feature(topo, obj).features.map(f => {
        rewindInverted(f);
        return { f, b: d3.geoBounds(f) };
      }),
      borders: topojson.mesh(topo, obj, (a, b) => a !== b)
    };
  }

  function rewindInverted(f) {
    // Three 1:10m Maldives rings are stored inverted, which d3 reads as "the whole globe except
    // this island" and paints every zoomed-in view as land. Reverse any ring set over half the globe.
    const g = f.geometry;
    const polys = g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : [];
    for (const p of polys) {
      if (d3.geoArea({ type: 'Polygon', coordinates: p }) > 2 * Math.PI) p.forEach(ring => ring.reverse());
    }
  }

  function prepCountryLabels(geo) {
    const area = d3.geoPath(d3.geoMercator().scale(WORLD / (2 * Math.PI)).translate([WORLD / 2, WORLD / 2])).area;
    return geo.features.map(({ f }) => {
      const raw = f.properties && f.properties.name;
      if (!raw || raw === 'Antarctica') return null;
      const g = f.geometry;
      const polys = g.type === 'MultiPolygon' ? g.coordinates.map(c => ({ type: 'Polygon', coordinates: c })) : [g];
      let best = null, bestArea = -1;
      for (const p of polys) {
        const a = area(p);
        if (a > bestArea) { bestArea = a; best = p; }
      }
      const [lon, lat] = d3.geoCentroid(best);
      return { name: (NAME_FIX[raw] || raw).toUpperCase(), lon, lat, area: bestArea };
    }).filter(d => d && d.area > 0).sort((a, b) => b.area - a.area);
  }

  function ensureHiRes() {
    if (!GEO.hi && window.WORLD_10M) {
      GEO.hi = prepGeo(window.WORLD_10M);
    }
  }

  // ---------------------------------------------------------------- colors

  function colorKey(l) {
    if (state.color === 'origin') return l.o.key;
    if (state.color === 'destCountry') return l.d.country || l.d.name;
    return 'all';
  }

  function buildColors() {
    const theme = THEMES[state.theme];
    if (state.color === 'single') {
      return { of: () => theme.series[0], entries: [] };
    }
    // Ranked on the full data, never the filtered slice, so a filter never repaints survivors.
    const ranked = d3.rollups(DATA.links, v => d3.sum(v, l => l.vol), colorKey).sort((a, b) => b[1] - a[1]);
    const top = new Map(ranked.slice(0, 3).map(([k], i) => [k, theme.series[i]]));
    const name = k => state.color === 'origin' ? DATA.byKey.get(k).name : k;
    const entries = ranked.slice(0, 3).map(([k]) => ({ label: name(k), color: top.get(k) }));
    if (ranked.length > 3) entries.push({ label: 'Other', color: theme.other });
    return { of: l => top.get(colorKey(l)) || theme.other, entries };
  }

  // ---------------------------------------------------------------- model

  let model = null;

  function visibleLinks() {
    const f = view.tableFilter;
    if (!f) return DATA.links;
    return DATA.links.filter(l => (f.role === 'origin' ? l.o.key : l.d.key) === f.key);
  }

  function widthScale(dmin, dmax) {
    const [min, max] = WIDTHS[state.width];
    if (!(dmax > 0)) return () => min;
    if (state.widthScale === 'compressed') {
      // Same rule as the original "log" option: a power scale whose exponent rises until
      // the smallest flow is no wider than the minimum.
      let exp = 0.5;
      const pow = d3.scalePow().exponent(exp).domain([0, dmax]).range([0, max]);
      while (pow(dmin) > min && exp < 1.1) pow.exponent(exp += 0.1);
      if (pow(dmin) > min) return pow;
      const lin = d3.scaleLinear().domain([pow(dmin), max]).range([min, max]);
      return v => lin(pow(v));
    }
    const lin = d3.scaleLinear().domain([0, dmax]).range([0, max]);
    if (lin(dmin) < min) lin.domain([dmin, dmax]).range([min, max]);
    return lin;
  }

  function buildModel() {
    const links = visibleLinks();
    const colors = buildColors();
    const theme = THEMES[state.theme];
    const segments = [];
    let unrouted = [];

    if (state.style === 'bundled') {
      const fromOrigin = state.bundleBy === 'origin';
      const groups = d3.groups(links, l => (fromOrigin ? l.o.key : l.d.key) + '|' + colorKey(l));
      for (const [, groupLinks] of groups) {
        const src = fromOrigin ? groupLinks[0].o : groupLinks[0].d;
        // Merge targets that share a spot: the original layout loops forever on coincident points.
        const spots = new Map();
        for (const l of groupLinks) {
          const t = fromOrigin ? l.d : l.o;
          const x = Math.round((t.bx - src.bx) * LEVEL20), y = Math.round((t.by - src.by) * LEVEL20);
          if (Math.abs(x) < 8 && Math.abs(y) < 8) continue; // self-link: nothing to draw
          const k = Math.round(x / 8) + ',' + Math.round(y / 8);
          let spot = spots.get(k);
          if (!spot) spots.set(k, spot = { x, y, links: [], vol: 0 });
          spot.links.push(l);
          spot.vol += l.vol;
        }
        const targets = [...spots.values()];
        if (!targets.length) continue;
        const layout = FlowEngine.layout(
          { x: 0, y: 0, key: 'src' },
          targets.map((t, i) => ({ x: t.x, y: t.y, key: i })),
          targets.map(t => t.vol)
        );
        const group = { src, layout, color: colors.of(groupLinks[0]) };
        for (const path of layout.build(i => targets[i].vol)) {
          segments.push({
            id: 'seg:' + src.key + ':' + colorKey(groupLinks[0]) + ':' + path.id,
            group, path, color: group.color, weight: path.weight,
            linkIds: path.leafs.flatMap(i => targets[i].links.map(l => l.id))
          });
        }
      }
    }
    else if (state.style === 'maritime') {
      const lanes = buildMaritime(links, colors);
      segments.push(...lanes);
      unrouted = lanes.unrouted || [];
    }
    else {
      for (const l of links) {
        if (l.o.bx === l.d.bx && l.o.by === l.d.by) continue;
        segments.push({ id: 'link:' + l.id, link: l, color: colors.of(l), weight: l.vol, linkIds: [l.id], pts: geometry(l) });
      }
    }

    const weights = segments.filter(s => !s.approach).map(s => s.weight);
    const scale = widthScale(d3.min(weights), d3.max(weights));
    const layouts = new Set(segments.filter(s => s.group).map(s => s.group.layout));
    layouts.forEach(layout => layout.paths(scale)); // sets widths and the screen-space branch offsets
    for (const s of segments) s.width = s.approach ? 1.4 : s.group ? s.path.width() : scale(s.weight);
    segments.sort((a, b) => b.width - a.width);

    // Terminals present in the visible links.
    const nodes = new Map();
    const node = t => {
      let n = nodes.get(t.key);
      if (!n) nodes.set(t.key, n = { t, out: 0, in: 0, outN: 0, inN: 0, linkIds: [], color: null, topOut: 0 });
      return n;
    };
    for (const l of links) {
      const o = node(l.o), d = node(l.d);
      o.out += l.vol; o.outN++; o.linkIds.push(l.id);
      d.in += l.vol; d.inN++; d.linkIds.push(l.id);
      if (l.vol > o.topOut) { o.topOut = l.vol; o.color = colors.of(l); }
    }
    const nodeList = [...nodes.values()];
    const maxVol = d3.max(nodeList, n => n.out + n.in) || 1;
    const r = d3.scaleSqrt().domain([0, maxVol]).range([0, 15]);
    for (const n of nodeList) {
      n.vol = n.out + n.in;
      n.role = n.out > 0 ? 'origin' : 'dest';
      n.fill = n.role === 'origin' ? n.color : theme.dest;
      n.r = state.terminals === 'bubbles' ? Math.max(3.5, r(n.vol)) : (n.role === 'origin' ? 4.5 : 3.5);
    }
    nodeList.sort((a, b) => b.vol - a.vol);

    model = { links, segments, nodes: nodeList, scale, colors, unrouted, dmin: d3.min(weights), dmax: d3.max(weights) };
  }

  function geometry(l) {
    if (state.style !== 'arc') return null;
    // Great circle from the original engine (arc.js port), in longitudes relative to the origin.
    let dx = l.d.lon - l.o.lon;
    if (dx > 180) dx -= 360;
    if (dx < -180) dx += 360;
    const cnt = Math.max(Math.round(Math.abs(dx / 4)), 10);
    return FlowEngine.arc({ x: 0, y: l.o.lat }, { x: dx, y: l.d.lat }, cnt)
      .map(([x, y]) => [baseX(l.o.lon + x), baseY(y)]);
  }

  // ---------------------------------------------------------------- maritime routing
  //
  // Indicative routes: the shortest path over the sea-lane network, forced through every chokepoint
  // Kpler recorded for the voyage ("Zone Canal Transit") and kept away from the tracked ones it did
  // not record. Not a vessel track.

  const KPLER_TO_TAG = {
    'Panama Canal': 'panama', 'Suez Canal': 'suez', 'Bab El Mandeb': 'babalmandab',
    'Strait of Hormuz': 'ormuz', 'Cape of Good Hope': 'south_africa'
  };
  const TRACKED = Object.values(KPLER_TO_TAG);
  const ARCTIC = ['northwest', 'bering']; // never used by NGL trade; otherwise USGC→Asia "shortcuts" over Canada
  const PASSAGE_NAMES = {
    panama: 'Panama Canal', suez: 'Suez Canal', babalmandab: 'Bab El Mandeb', ormuz: 'Strait of Hormuz',
    south_africa: 'Cape of Good Hope', malacca: 'Malacca Strait', gibraltar: 'Gibraltar', sunda: 'Sunda Strait',
    chili: 'Strait of Magellan', bosporus: 'Bosporus', dardanelles: 'Dardanelles', bering: 'Bering Strait',
    northwest: 'Northwest Passage'
  };
  const KM_PER_NM = 1.852;

  let SEA = null;

  function haversine(lon1, lat1, lon2, lat2) {
    const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371.0088 * Math.asin(Math.sqrt(s));
  }

  function seaGraph() {
    if (SEA || !window.MARNET) return SEA;
    const ids = new Map(), lon = [], lat = [], adj = [];
    const node = ([x, y]) => {
      if (x === 180) x = -180; // the network splits lanes at the date line; ±180 is one meridian
      const k = x.toFixed(5) + ',' + y.toFixed(5);
      let i = ids.get(k);
      if (i === undefined) {
        i = lon.length;
        ids.set(k, i);
        lon.push(x);
        lat.push(y);
        adj.push([]);
      }
      return i;
    };
    for (const f of window.MARNET.features) {
      const tag = (f.properties && f.properties.passage) || null;
      const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const line of lines) {
        for (let i = 1; i < line.length; i++) {
          const a = node(line[i - 1]), b = node(line[i]);
          if (a === b) continue;
          const w = haversine(lon[a], lat[a], lon[b], lat[b]);
          adj[a].push({ to: b, w, tag });
          adj[b].push({ to: a, w, tag });
        }
      }
    }
    // A passage is entered and left at its tagged nodes that also touch untagged lanes.
    const ends = {}, open = [];
    adj.forEach((edges, i) => {
      if (edges.some(e => !e.tag)) open.push(i);
      const tags = new Set(edges.filter(e => e.tag).map(e => e.tag));
      if (tags.size && edges.some(e => !e.tag)) for (const t of tags) (ends[t] = ends[t] || []).push(i);
    });
    SEA = { lon, lat, adj, ends, open, trees: new Map(), snaps: new Map(), routes: new Map() };
    return SEA;
  }

  // Terminals join the network at the nearest lane node outside a passage.
  function snap(t) {
    let i = SEA.snaps.get(t.key);
    if (i === undefined) {
      let best = -1, bestKm = Infinity;
      for (const n of SEA.open) {
        if (Math.abs(SEA.lat[n] - t.lat) > 20) continue;
        const km = haversine(t.lon, t.lat, SEA.lon[n], SEA.lat[n]);
        if (km < bestKm) { bestKm = km; best = n; }
      }
      if (best < 0) for (const n of SEA.open) {
        const km = haversine(t.lon, t.lat, SEA.lon[n], SEA.lat[n]);
        if (km < bestKm) { bestKm = km; best = n; }
      }
      SEA.snaps.set(t.key, i = best);
    }
    return i;
  }

  // Shortest-path tree from one node, memoized. allow(edge) decides which lanes may be used.
  function tree(src, key, allow) {
    const memo = src + '|' + key;
    let t = SEA.trees.get(memo);
    if (t) return t;
    const n = SEA.lon.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
    const heapNode = [src], heapDist = [0];
    dist[src] = 0;
    while (heapNode.length) {
      // pop the smallest (binary heap on parallel arrays)
      const u = heapNode[0], du = heapDist[0];
      const lastN = heapNode.pop(), lastD = heapDist.pop();
      if (heapNode.length) {
        let i = 0;
        heapNode[0] = lastN; heapDist[0] = lastD;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heapNode.length && heapDist[l] < heapDist[m]) m = l;
          if (r < heapNode.length && heapDist[r] < heapDist[m]) m = r;
          if (m === i) break;
          [heapNode[i], heapNode[m]] = [heapNode[m], heapNode[i]];
          [heapDist[i], heapDist[m]] = [heapDist[m], heapDist[i]];
          i = m;
        }
      }
      if (du > dist[u]) continue;
      for (const e of SEA.adj[u]) {
        if (!allow(e)) continue;
        const nd = du + e.w;
        if (nd < dist[e.to]) {
          dist[e.to] = nd;
          prev[e.to] = u;
          let i = heapNode.length;
          heapNode.push(e.to);
          heapDist.push(nd);
          while (i > 0) {
            const p = (i - 1) >> 1;
            if (heapDist[p] <= heapDist[i]) break;
            [heapNode[i], heapNode[p]] = [heapNode[p], heapNode[i]];
            [heapDist[i], heapDist[p]] = [heapDist[p], heapDist[i]];
            i = p;
          }
        }
      }
    }
    SEA.trees.set(memo, t = { dist, prev });
    return t;
  }

  const laneTree = (src, forbid) => tree(src, 'lanes:' + [...forbid].sort().join(','), e => !e.tag || !forbid.has(e.tag));
  const passageTree = (src, tag) => tree(src, 'pass:' + tag, e => e.tag === tag);

  function nodesTo(t, target) {
    const out = [];
    for (let u = target; u !== -1; u = t.prev[u]) out.push(u);
    return out.reverse();
  }

  function permutations(list) {
    if (list.length <= 1) return [list];
    return list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map(p => [x, ...p]));
  }

  // Cheapest s→t path that runs through every passage in `order`, in that order.
  function viaPassages(s, t, order, forbid) {
    let states = [{ node: s, km: 0, steps: [] }];
    for (const tag of order) {
      const ends = SEA.ends[tag] || [];
      const bestAt = new Map();
      for (const st of states) {
        const lanes = laneTree(st.node, forbid);
        for (const a of ends) {
          if (!isFinite(lanes.dist[a])) continue;
          const through = passageTree(a, tag);
          for (const b of ends) {
            if (b === a || !isFinite(through.dist[b])) continue;
            const km = st.km + lanes.dist[a] + through.dist[b];
            const cur = bestAt.get(b);
            if (!cur || km < cur.km) bestAt.set(b, { node: b, km, steps: [...st.steps, [lanes, a], [through, b]] });
          }
        }
      }
      states = [...bestAt.values()];
      if (!states.length) return null;
    }
    let best = null;
    for (const st of states) {
      const lanes = laneTree(st.node, forbid);
      if (!isFinite(lanes.dist[t])) continue;
      const km = st.km + lanes.dist[t];
      if (!best || km < best.km) best = { km, steps: [...st.steps, [lanes, t]] };
    }
    if (!best) return null;
    const nodes = [s];
    for (const [tr, to] of best.steps) nodes.push(...nodesTo(tr, to).slice(1));
    return { km: best.km, nodes };
  }

  function seaRoute(link) {
    let r = SEA.routes.get(link.id);
    if (r !== undefined) return r;
    const s = snap(link.o), t = snap(link.d);
    const recorded = link.canal ? link.canal.split(',').map(x => x.trim()) : [];
    const required = recorded.map(x => KPLER_TO_TAG[x]).filter(Boolean);
    // A known blank means "no tracked chokepoint"; an unknown canal (no column) only blocks the Arctic.
    const forbid = new Set(link.canal === null ? ARCTIC : [...ARCTIC, ...TRACKED]);
    const free = laneTree(s, new Set(ARCTIC));
    const freeKm = free.dist[t];
    let best = null;
    if (required.length) {
      for (const order of permutations(required)) {
        const c = viaPassages(s, t, order, forbid);
        if (c && (!best || c.km < best.km)) best = c;
      }
    }
    else {
      const lanes = laneTree(s, forbid);
      if (isFinite(lanes.dist[t])) best = { km: lanes.dist[t], nodes: nodesTo(lanes, t) };
    }
    // Recorded transits that can't be honored sensibly (e.g. multi-leg voyages) fall back to the
    // shortest route and say so in the tooltip.
    let matched = link.canal !== null;
    if (!best || best.km > freeKm * 3) {
      best = isFinite(freeKm) ? { km: freeKm, nodes: nodesTo(free, t) } : null;
      matched = false;
    }
    if (best) {
      const used = new Set();
      for (let i = 1; i < best.nodes.length; i++) {
        const e = SEA.adj[best.nodes[i - 1]].find(x => x.to === best.nodes[i]);
        if (e && e.tag) used.add(e.tag);
      }
      r = { km: best.km, nodes: best.nodes, via: [...used], recorded, matched, s, t };
    }
    else r = null;
    SEA.routes.set(link.id, r);
    return r;
  }

  // Lon/lat → base coords, unwrapping across the date line so a lane stays continuous.
  function unwrap(lonLat) {
    const out = [];
    let prev = null;
    for (let [x, y] of lonLat) {
      if (prev !== null) {
        while (x - prev > 180) x -= 360;
        while (x - prev < -180) x += 360;
      }
      out.push([baseX(x), baseY(y)]);
      prev = x;
    }
    return out;
  }

  // One segment per stretch of lane carrying the same set of routes, so volumes add up where
  // routes share a lane (the maritime counterpart of the bundled tree).
  function buildMaritime(links, colors) {
    if (!seaGraph()) return [];
    const edges = new Map(), approaches = new Map(), unrouted = [];
    for (const l of links) {
      const r = seaRoute(l);
      if (!r) { unrouted.push(l); continue; }
      const ck = colorKey(l);
      for (let i = 1; i < r.nodes.length; i++) {
        const a = Math.min(r.nodes[i - 1], r.nodes[i]), b = Math.max(r.nodes[i - 1], r.nodes[i]);
        const k = ck + '|' + a + '-' + b;
        let e = edges.get(k);
        if (!e) edges.set(k, e = { a, b, ck, ids: [], vol: 0, color: colors.of(l) });
        e.ids.push(l.id);
        e.vol += l.vol;
      }
      for (const [t, n] of [[l.o, r.s], [l.d, r.t]]) {
        const k = ck + '|' + t.key;
        let ap = approaches.get(k);
        if (!ap) approaches.set(k, ap = { t, n, ids: [], color: colors.of(l) });
        ap.ids.push(l.id);
      }
    }

    // Chain edges with identical route sets into polylines.
    const groups = new Map();
    for (const e of edges.values()) {
      const sig = e.ck + '|' + e.ids.slice().sort((x, y) => x - y).join(',');
      (groups.get(sig) || groups.set(sig, []).get(sig)).push(e);
    }
    const segments = [];
    for (const [sig, list] of groups) {
      const byNode = new Map();
      for (const e of list) for (const n of [e.a, e.b]) (byNode.get(n) || byNode.set(n, []).get(n)).push(e);
      const used = new Set();
      const walk = start => {
        const nodes = [start];
        let cur = start;
        for (;;) {
          const next = (byNode.get(cur) || []).find(e => !used.has(e));
          if (!next) break;
          used.add(next);
          cur = next.a === cur ? next.b : next.a;
          nodes.push(cur);
          if ((byNode.get(cur) || []).length !== 2) break;
        }
        return nodes;
      };
      const starts = [...byNode.keys()].filter(n => byNode.get(n).length !== 2);
      for (const n of starts.concat([...byNode.keys()])) {
        while ((byNode.get(n) || []).some(e => !used.has(e))) {
          const nodes = walk(n);
          if (nodes.length < 2) break;
          const pts = unwrap(nodes.map(i => [SEA.lon[i], SEA.lat[i]]));
          const e0 = list[0];
          segments.push({ id: 'lane:' + sig + ':' + segments.length, lane: true, pts, color: e0.color, weight: e0.vol, linkIds: e0.ids.slice() });
        }
      }
    }
    for (const ap of approaches.values()) {
      const pts = unwrap([[ap.t.lon, ap.t.lat], [SEA.lon[ap.n], SEA.lat[ap.n]]]);
      segments.push({ id: 'approach:' + ap.t.key + ':' + ap.color, approach: true, pts, color: ap.color, weight: 0, linkIds: ap.ids });
    }
    segments.unrouted = unrouted;
    return segments;
  }

  const smooth = d3.line().curve(d3.curveCatmullRom.alpha(0.5));

  function lanePath(s) {
    // Lanes that run past the date line are drawn again one world over, so both halves show.
    const xs = s.pts.map(p => p[0]), shifts = [0];
    if (d3.min(xs) < 0) shifts.push(WORLD);
    if (d3.max(xs) > WORLD) shifts.push(-WORLD);
    return shifts.map(dx => {
      const screen = s.pts.map(([x, y]) => [sx(x + dx), sy(y)]);
      return s.approach ? 'M' + screen.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L') : smooth(screen);
    }).join(' ');
  }

  function segmentPath(s) {
    if (s.lane || s.approach) return lanePath(s);
    if (s.group) {
      const { bx, by } = s.group.src, t = view.t;
      return s.path.d((input, out) => {
        out[0] = t.x + t.k * (bx + input[0] / LEVEL20);
        out[1] = t.y + t.k * (by + input[1] / LEVEL20);
      });
    }
    const { o, d } = s.link;
    const x0 = sx(o.bx), y0 = sy(o.by), x1 = sx(d.bx), y1 = sy(d.by);
    if (state.style === 'arc') {
      return 'M' + s.pts.map(([x, y]) => sx(x).toFixed(1) + ',' + sy(y).toFixed(1)).join('L');
    }
    if (state.style === 'curved') {
      // Quadratic bend to the right of travel, so A→B and B→A never sit on top of each other.
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, dx = x1 - x0, dy = y1 - y0;
      const bend = 0.22;
      return `M${x0},${y0}Q${mx - dy * bend},${my + dx * bend} ${x1},${y1}`;
    }
    return `M${x0},${y0}L${x1},${y1}`;
  }

  // ---------------------------------------------------------------- SVG layers

  const layers = {};
  for (const name of ['bg', 'casings', 'lines', 'dashes', 'hits', 'nodes', 'labels']) {
    if (name === 'bg') {
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('width', '100%');
      rect.setAttribute('height', '100%');
      rect.setAttribute('fill', 'transparent');
      svgEl.append(rect);
      continue;
    }
    layers[name] = svgEl.appendChild(document.createElementNS(SVG_NS, 'g'));
  }

  function svg(parent, tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return parent.appendChild(el);
  }

  function renderModelElements() {
    for (const name in layers) layers[name].replaceChildren();
    const reverse = state.style === 'bundled' && state.bundleBy === 'origin'; // engine draws branches toward the root

    for (const s of model.segments) {
      const w = s.width;
      s.els = {
        casing: svg(layers.casings, 'path', { class: 'flow-casing', 'stroke-width': w + 2 }),
        line: svg(layers.lines, 'path', { class: 'flow' + (s.approach ? ' approach' : ''), stroke: s.color, 'stroke-width': w }),
        dash: state.motion === 'dashes' && !s.lane && !s.approach
          ? svg(layers.dashes, 'path', { class: 'flow-dash' + (reverse ? ' rev' : ''), 'stroke-width': Math.max(1.2, w * 0.32) })
          : null,
        hit: svg(layers.hits, 'path', { class: 'flow-hit', 'stroke-width': Math.max(w + 10, 14) })
      };
      s.els.hit.addEventListener('pointerenter', e => hoverOn({ ids: new Set(s.linkIds) }, () => segmentTip(s), e));
      s.els.hit.addEventListener('pointermove', moveTip);
      s.els.hit.addEventListener('pointerleave', hoverOff);
      s.els.hit.addEventListener('click', e => {
        e.stopPropagation();
        select({ id: s.id, ids: new Set(s.linkIds), label: segmentLabel(s) });
      });
    }

    for (const n of model.nodes) {
      n.els = {
        dot: state.terminals === 'off' ? null : svg(layers.nodes, 'circle', { class: 'term ' + n.role, r: n.r, fill: n.fill }),
        hit: svg(layers.nodes, 'circle', {
          class: 'term-hit', r: Math.max(n.r + 4, 11), tabindex: 0, role: 'button',
          'aria-label': n.t.name + ', ' + fmt(n.vol) + ' ' + DATA.unit
        }),
        label: null
      };
      const sel = () => ({ id: 'term:' + n.t.key, ids: new Set(n.linkIds), label: n.t.name });
      n.els.hit.addEventListener('pointerenter', e => hoverOn({ ids: new Set(n.linkIds) }, () => terminalTip(n), e));
      n.els.hit.addEventListener('pointermove', moveTip);
      n.els.hit.addEventListener('pointerleave', hoverOff);
      n.els.hit.addEventListener('focus', () => hoverOn({ ids: new Set(n.linkIds) }, () => terminalTip(n), null, n));
      n.els.hit.addEventListener('blur', hoverOff);
      n.els.hit.addEventListener('click', e => { e.stopPropagation(); select(sel()); });
      n.els.hit.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(sel()); }
      });
      const showLabel = state.labels === 'all' || (state.labels === 'origins' && n.role === 'origin') ||
        (state.labels === 'destinations' && n.role === 'dest');
      if (showLabel) {
        n.els.label = svg(layers.labels, 'text', { class: 'term-label' + (n.role === 'dest' ? ' dest' : '') });
        n.els.label.textContent = n.t.name;
      }
    }
    applyHighlight();
  }

  function updateGeometry() {
    for (const s of model.segments) {
      const d = segmentPath(s);
      s.els.casing.setAttribute('d', d);
      s.els.line.setAttribute('d', d);
      s.els.hit.setAttribute('d', d);
      if (s.els.dash) s.els.dash.setAttribute('d', d);
    }
    for (const n of model.nodes) {
      const x = sx(n.t.bx), y = sy(n.t.by);
      n.x = x; n.y = y;
      if (n.els.dot) { n.els.dot.setAttribute('cx', x); n.els.dot.setAttribute('cy', y); }
      n.els.hit.setAttribute('cx', x);
      n.els.hit.setAttribute('cy', y);
    }
    placeTerminalLabels();
  }

  // ---------------------------------------------------------------- labels (greedy, no overlaps)

  const measureCtx = document.createElement('canvas').getContext('2d');
  const widthCache = new Map();
  function textWidth(text, font) {
    const key = font + '|' + text;
    let w = widthCache.get(key);
    if (w === undefined) {
      measureCtx.font = font;
      w = measureCtx.measureText(text).width;
      widthCache.set(key, w);
    }
    return w;
  }

  const overlaps = (a, boxes) => boxes.some(b => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0);

  function obstacleBoxes() {
    const v = visualEl.getBoundingClientRect(), boxes = [];
    for (const el of [legendEl, visualEl.querySelector('.zoombar')]) {
      const r = el.getBoundingClientRect();
      boxes.push({ x0: r.left - v.left - 2, y0: r.top - v.top - 2, x1: r.right - v.left + 2, y1: r.bottom - v.top + 2 });
    }
    return boxes;
  }

  function placeTerminalLabels() {
    const boxes = obstacleBoxes();
    if (state.terminals !== 'off') {
      for (const n of model.nodes) boxes.push({ x0: n.x - n.r, y0: n.y - n.r, x1: n.x + n.r, y1: n.y + n.r });
    }
    // Cap the labels by the space available; nodes are sorted by volume and only on-screen ones
    // count, so zooming in reveals more.
    const maxLabels = Math.max(8, Math.round(view.W * view.H / 12000));
    let placedCount = 0;
    for (const n of model.nodes) {
      const label = n.els.label;
      if (!label) continue;
      if (placedCount >= maxLabels || n.x < 0 || n.y < 0 || n.x > view.W || n.y > view.H) {
        label.style.display = 'none';
        continue;
      }
      const w = textWidth(n.t.name, (n.role === 'dest' ? '400' : '600') + ' 11px ' + FONT), h = 13;
      const r = state.terminals === 'off' ? 2 : n.r;
      const options = [
        [n.x + r + 4, n.y - h / 2, 'start'],
        [n.x - r - 4 - w, n.y - h / 2, 'end'],
        [n.x - w / 2, n.y - r - 3 - h, 'middle'],
        [n.x - w / 2, n.y + r + 3, 'middle']
      ];
      let placed = false;
      for (const [x0, y0, anchor] of options) {
        const box = { x0, y0, x1: x0 + w, y1: y0 + h };
        if (box.x0 < 2 || box.y0 < 2 || box.x1 > view.W - 2 || box.y1 > view.H - 2 || overlaps(box, boxes)) continue;
        const tx = anchor === 'start' ? x0 : anchor === 'end' ? x0 + w : x0 + w / 2;
        label.setAttribute('x', tx);
        label.setAttribute('y', y0 + h - 3);
        label.setAttribute('text-anchor', anchor);
        label.style.display = '';
        boxes.push(box);
        placed = true;
        placedCount++;
        break;
      }
      if (!placed) label.style.display = 'none';
    }
  }

  // ---------------------------------------------------------------- basemap (canvas)

  const ctx = canvas.getContext('2d');

  // Visible lon/lat box, from the zoom transform rather than proj.invert(): at full zoom-out the
  // left edge is exactly -180°, which invert() wraps to +180°, so the box collapsed to a sliver at the
  // date line and every continent except the date-line-crossing ones was culled.
  function viewBounds() {
    const { t, W, H } = view;
    const lon = x => (x - t.x) / t.k / WORLD * 360 - 180;
    const lat = y => 360 / Math.PI * Math.atan(Math.exp(Math.PI * (1 - 2 * (y - t.y) / t.k / WORLD))) - 90;
    return { w: lon(0) - 1, e: lon(W) + 1, n: lat(0) + 1, s: lat(H) - 1 };
  }

  function intersects(b, v) {
    const [[w, s], [e, n]] = b;
    if (w > e) return true; // crosses the antimeridian: just draw it
    return !(e < v.w || w > v.e || n < v.s || s > v.n);
  }

  function drawBasemap() {
    const { W, H, dpr, t } = view, theme = THEMES[state.theme];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.ocean;
    ctx.fillRect(0, 0, W, H);

    const proj = projection(), path = d3.geoPath(proj, ctx), vb = viewBounds();
    const geo = !view.zooming && t.k >= HI_RES_FROM_K && GEO.hi ? GEO.hi : GEO.lo;

    ctx.beginPath();
    for (const { f, b } of geo.features) if (intersects(b, vb)) path(f);
    ctx.fillStyle = theme.land;
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.75;
    ctx.strokeStyle = theme.coast;
    ctx.stroke();

    ctx.beginPath();
    path(geo.borders);
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = theme.border;
    ctx.stroke();

    if (GEO.states && t.k >= 6) {
      ctx.beginPath();
      path(GEO.states);
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = theme.state;
      ctx.stroke();
    }

    if (state.mapLabels === 'on') drawMapLabels(proj, theme);
  }

  function drawMapLabels(proj, theme) {
    const { W, H, t } = view, boxes = obstacleBoxes();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const spaced = 'letterSpacing' in ctx;

    let font = 'italic 11px ' + FONT;
    ctx.font = font;
    ctx.fillStyle = theme.seaLabel;
    if (spaced) ctx.letterSpacing = '0.5px';
    for (const s of SEAS) {
      if (t.k < s.minK || (s.maxK && t.k > s.maxK)) continue;
      const [x, y] = proj([s.lon, s.lat]);
      const w = textWidth(s.name, font) + 6;
      const box = { x0: x - w / 2, y0: y - 8, x1: x + w / 2, y1: y + 8 };
      if (box.x0 < 0 || box.x1 > W || box.y0 < 0 || box.y1 > H || overlaps(box, boxes)) continue;
      ctx.fillText(s.name, x, y);
      boxes.push(box);
    }

    font = '600 10px ' + FONT;
    ctx.font = font;
    ctx.fillStyle = theme.countryLabel;
    if (spaced) ctx.letterSpacing = '1px';
    for (const c of GEO.labels) {
      const w = textWidth(c.name, font) + c.name.length + 6;
      if (c.area * t.k * t.k < w * 30) continue; // only label shapes the name roughly fits in
      const [x, y] = proj([c.lon, c.lat]);
      const box = { x0: x - w / 2, y0: y - 8, x1: x + w / 2, y1: y + 8 };
      if (box.x0 < 0 || box.x1 > W || box.y0 < 0 || box.y1 > H || overlaps(box, boxes)) continue;
      ctx.fillText(c.name, x, y);
      boxes.push(box);
    }
    if (spaced) ctx.letterSpacing = '0px';
  }

  // ---------------------------------------------------------------- render loop

  let frame = 0;
  function scheduleRender() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      drawBasemap();
      updateGeometry();
    });
  }

  // ---------------------------------------------------------------- zoom

  const zoom = d3.zoom()
    .scaleExtent([1, MAX_K])
    .translateExtent([[0, 0], [WORLD, WORLD]])
    .on('start', () => { view.zooming = true; })
    .on('zoom', e => { view.t = e.transform; hideTip(); scheduleRender(); })
    .on('end', () => { view.zooming = false; scheduleRender(); });
  const svgSel = d3.select(svgEl).call(zoom);

  function dataExtent() {
    const xs = [], ys = [];
    for (const n of model.nodes) { xs.push(n.t.bx); ys.push(n.t.by); }
    for (const s of model.segments) if (s.pts) for (const [x, y] of s.pts) { xs.push(x); ys.push(y); }
    if (!xs.length) return null;
    return [[d3.min(xs), d3.min(ys)], [d3.max(xs), d3.max(ys)]];
  }

  function fitToData(animate) {
    const e = dataExtent();
    if (!e || !view.W) return;
    const [[x0, y0], [x1, y1]] = e;
    const padX = 70, padTop = 46, padBottom = 34;
    const dx = Math.max(x1 - x0, 1e-4), dy = Math.max(y1 - y0, 1e-4);
    let k = Math.min((view.W - 2 * padX) / dx, (view.H - padTop - padBottom) / dy);
    k = Math.max(view.kMin, Math.min(k, 2 ** 11));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const t = d3.zoomIdentity.translate(view.W / 2 - k * cx, (view.H + padTop - padBottom) / 2 - k * cy).scale(k);
    (animate && !reduceMotion ? svgSel.transition().duration(650) : svgSel).call(zoom.transform, t);
  }

  $('zoom-in').addEventListener('click', () => svgSel.transition().duration(reduceMotion ? 0 : 250).call(zoom.scaleBy, 2));
  $('zoom-out').addEventListener('click', () => svgSel.transition().duration(reduceMotion ? 0 : 250).call(zoom.scaleBy, 0.5));
  $('zoom-fit').addEventListener('click', () => fitToData(true));
  svgEl.addEventListener('click', () => { if (view.selection) select(null); });

  function resize() {
    const r = visualEl.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!r.width || !r.height) return;
    if (r.width === view.W && r.height === view.H && dpr === view.dpr) return;
    view.W = r.width;
    view.H = r.height;
    view.dpr = dpr;
    canvas.width = Math.round(view.W * view.dpr); // this clears the canvas, so redraw right away below
    canvas.height = Math.round(view.H * view.dpr);
    view.kMin = Math.max(view.W, view.H) / WORLD;
    zoom.extent([[0, 0], [view.W, view.H]]).scaleExtent([view.kMin, MAX_K]);
    if (!view.ready) {
      view.ready = true;
      const start = initialView();
      if (start) svgSel.call(zoom.transform, start);
      else fitToData(false);
    }
    else {
      svgSel.call(zoom.transform, view.t); // re-clamp to the new size
    }
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    drawBasemap();
    updateGeometry();
  }
  new ResizeObserver(resize).observe(visualEl);

  // ---------------------------------------------------------------- highlight, selection, tooltip

  function applyHighlight() {
    const active = view.hover || view.selection, ids = active && active.ids;
    const on = list => !ids || list.some(id => ids.has(id));
    for (const s of model.segments) {
      const dim = !on(s.linkIds);
      s.els.casing.classList.toggle('dim', dim);
      s.els.line.classList.toggle('dim', dim);
      if (s.els.dash) s.els.dash.classList.toggle('dim', dim);
    }
    for (const n of model.nodes) {
      const dim = !on(n.linkIds);
      if (n.els.dot) n.els.dot.classList.toggle('dim', dim);
      if (n.els.label) n.els.label.classList.toggle('dim', dim);
    }
  }

  function hoverOn(target, content, event, node) {
    view.hover = target;
    applyHighlight();
    showTip(content(), event, node);
  }

  function hoverOff() {
    view.hover = null;
    applyHighlight();
    hideTip();
  }

  function select(sel) {
    if (sel && view.selection && view.selection.id === sel.id) sel = null; // click again to clear
    view.selection = sel;
    if (sel) view.tableFilter = null;
    applyHighlight();
    renderTables();
  }

  function segmentLabel(s) {
    const ls = s.linkIds.map(id => DATA.links[id]);
    if (ls.length === 1) return ls[0].o.name + ' → ' + ls[0].d.name;
    const src = s.group.src;
    return (state.bundleBy === 'origin' ? 'from ' : 'to ') + src.name + ' (' + ls.length + ' routes)';
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text; // labels are data: never innerHTML
    return e;
  }

  function keyedTitle(color, text) {
    const row = el('div', 'tt-title');
    const key = el('span', 'tt-key');
    key.style.background = color;
    row.append(key, el('span', '', text));
    return row;
  }

  function segmentTip(s) {
    const ls = s.linkIds.map(id => DATA.links[id]).sort((a, b) => b.vol - a.vol);
    const total = d3.sum(ls, l => l.vol), shown = d3.sum(model.links, l => l.vol);
    const frag = document.createDocumentFragment();
    frag.append(el('div', 'tt-value', fmt(total) + ' ' + DATA.unit));
    if (ls.length === 1) {
      const l = ls[0];
      frag.append(keyedTitle(s.color, l.o.name + ' → ' + l.d.name));
      frag.append(el('div', 'tt-sub', (place(l.o) || l.o.name) + ' → ' + (place(l.d) || l.d.name)));
      routeDetails(frag, l);
    }
    else if (!s.group) {
      frag.append(keyedTitle(s.color, s.approach ? 'Port approach' : 'Sea lane'));
      frag.append(el('div', 'tt-sub', ls.length + ' routes on this stretch'));
      const table = el('table', 'tt-list');
      for (const l of ls.slice(0, 6)) {
        const tr = table.insertRow();
        tr.append(el('td', '', l.o.name + ' → ' + l.d.name), el('td', 'num', fmt(l.vol)));
      }
      if (ls.length > 6) {
        const tr = table.insertRow();
        tr.append(el('td', '', '+' + (ls.length - 6) + ' more'), el('td', 'num', fmt(d3.sum(ls.slice(6), l => l.vol))));
      }
      frag.append(table);
    }
    else {
      const fromOrigin = state.bundleBy === 'origin', src = s.group.src;
      frag.append(keyedTitle(s.color, (fromOrigin ? 'From ' : 'To ') + src.name));
      frag.append(el('div', 'tt-sub', ls.length + (fromOrigin ? ' destinations' : ' origins') + ' on this branch'));
      const table = el('table', 'tt-list');
      for (const l of ls.slice(0, 6)) {
        const tr = table.insertRow();
        tr.append(el('td', '', fromOrigin ? l.d.name : l.o.name), el('td', 'num', fmt(l.vol)));
      }
      if (ls.length > 6) {
        const tr = table.insertRow();
        tr.append(el('td', '', '+' + (ls.length - 6) + ' more'), el('td', 'num', fmt(d3.sum(ls.slice(6), l => l.vol))));
      }
      frag.append(table);
    }
    if (shown > 0) {
      const share = total / shown;
      frag.append(el('div', 'tt-share', (share < 0.001 ? '<0.1%' : d3.format('.1%')(share)) + ' of the volume on the map'));
    }
    if (s.lane || s.approach) frag.append(el('div', 'tt-share', 'Indicative sea route, not a vessel track'));
    return frag;
  }

  function routeDetails(frag, l) {
    if (l.trades) frag.append(el('div', 'tt-sub', l.trades + (l.trades === 1 ? ' voyage' : ' voyages')));
    if (l.canal) frag.append(el('div', 'tt-sub', 'Recorded transits: ' + l.canal));
    const r = state.style === 'maritime' && SEA && SEA.routes.get(l.id);
    if (r) {
      const via = r.via.map(t => PASSAGE_NAMES[t] || t);
      frag.append(el('div', 'tt-sub', '≈ ' + fmt(r.km / KM_PER_NM) + ' nm at sea' + (via.length ? ' via ' + via.join(', ') : '')));
      if (!r.matched && l.canal !== null) frag.append(el('div', 'tt-warn', '⚠ Recorded transits could not be followed; shortest route shown'));
    }
    if (l.o.approx || l.d.approx) frag.append(el('div', 'tt-sub', 'Approximate location (port zone)'));
  }

  function terminalTip(n) {
    const frag = document.createDocumentFragment();
    frag.append(el('div', 'tt-value', fmt(n.vol) + ' ' + DATA.unit));
    frag.append(keyedTitle(n.fill, n.t.name));
    if (place(n.t)) frag.append(el('div', 'tt-sub', place(n.t)));
    if (n.t.approx) frag.append(el('div', 'tt-sub', 'Approximate location (port zone)'));
    if (n.out) frag.append(el('div', 'tt-sub', 'Loaded ' + fmt(n.out) + ' → ' + n.outN + (n.outN === 1 ? ' destination' : ' destinations')));
    if (n.in) frag.append(el('div', 'tt-sub', 'Received ' + fmt(n.in) + ' ← ' + n.inN + (n.inN === 1 ? ' origin' : ' origins')));
    return frag;
  }

  function showTip(content, event, node) {
    tipEl.replaceChildren(content);
    tipEl.hidden = false;
    if (event) moveTip(event);
    else if (node) positionTip(node.x, node.y);
  }

  function moveTip(e) {
    const r = visualEl.getBoundingClientRect();
    positionTip(e.clientX - r.left, e.clientY - r.top);
  }

  function positionTip(px, py) {
    const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    let x = px + 14, y = py + 14;
    if (x + tw > view.W - 4) x = px - tw - 14;
    if (y + th > view.H - 4) y = py - th - 14;
    tipEl.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`;
  }

  function hideTip() {
    tipEl.hidden = true;
  }

  // ---------------------------------------------------------------- legend

  function niceValues(dmin, dmax) {
    const roundDown = v => { const p = 10 ** Math.floor(Math.log10(v)); return Math.floor(v / p) * p; };
    const values = [dmax, dmax / 3, Math.max(dmin, dmax / 15)].map(roundDown).filter(v => v >= dmin * 0.999);
    return [...new Set(values.length ? values : [dmax])];
  }

  function renderLegend() {
    const theme = THEMES[state.theme];
    legendEl.replaceChildren();
    legendEl.classList.toggle('collapsed', view.legendCollapsed);
    const toggle = el('button', 'lg-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(!view.legendCollapsed));
    toggle.append(el('span', '', 'Legend'), el('span', '', view.legendCollapsed ? '▸' : '▾'));
    toggle.addEventListener('click', () => {
      view.legendCollapsed = !view.legendCollapsed;
      renderLegend();
      placeTerminalLabels();
      scheduleRender();
    });
    const body = el('div', 'lg-body');
    legendEl.append(toggle, body);

    if (model.segments.length) {
      const sec = el('div');
      sec.append(el('div', 'lg-title', state.style === 'bundled' ? 'Volume (branches add up)'
        : state.style === 'maritime' ? 'Volume on each lane (routes add up)' : 'Volume per route'));
      for (const v of niceValues(model.dmin, model.dmax)) {
        const w = model.scale(v), row = el('div', 'lg-row');
        const key = document.createElementNS(SVG_NS, 'svg');
        key.setAttribute('width', 34);
        key.setAttribute('height', Math.max(12, w + 2));
        svg(key, 'line', {
          x1: w / 2 + 1, x2: 34 - w / 2 - 1, y1: '50%', y2: '50%',
          stroke: theme.textMuted, 'stroke-width': w, 'stroke-linecap': 'round'
        });
        row.append(key, el('span', '', compact(v)));
        sec.append(row);
      }
      body.append(sec);
    }

    if (model.colors.entries.length) {
      const sec = el('div');
      sec.append(el('div', 'lg-title', state.color === 'origin' ? 'Origin' : 'Destination country'));
      for (const c of model.colors.entries) {
        const row = el('div', 'lg-row'), key = el('span', 'tt-key');
        key.style.background = c.color;
        row.append(key, el('span', '', c.label));
        sec.append(row);
      }
      body.append(sec);
    }

    if (state.terminals !== 'off') {
      const row = el('div', 'lg-row');
      const key = document.createElementNS(SVG_NS, 'svg');
      key.setAttribute('width', 30);
      key.setAttribute('height', 12);
      svg(key, 'circle', { cx: 6, cy: 6, r: 4.5, fill: state.color === 'single' ? theme.series[0] : theme.other, stroke: theme.casing, 'stroke-width': 1.5 });
      svg(key, 'circle', { cx: 22, cy: 6, r: 4, fill: theme.dest, 'fill-opacity': 0.22, stroke: theme.dest, 'stroke-width': 1.5 });
      row.append(key, el('span', '', 'Origin · Destination'));
      body.append(row);
    }

    if (state.style === 'maritime') {
      body.append(el('div', 'lg-warn', 'Indicative sea routes, following recorded canal and strait transits. Dashed: port approach.'));
    }
    if (DATA.skipped) {
      body.append(el('div', 'lg-warn', '⚠ ' + fmt(DATA.skipped) + ' routes (' + compact(DATA.skippedVolume) + ') not in this sample: no coordinates, or outside the top routes'));
    }
    if (model.unrouted.length) {
      body.append(el('div', 'lg-warn', '⚠ ' + model.unrouted.length + ' routes could not be routed at sea'));
    }
  }

  // ---------------------------------------------------------------- dashboard tables (cross-filter)

  function tableLinks(role) {
    if (view.selection) return DATA.links.filter(l => view.selection.ids.has(l.id));
    if (view.tableFilter && view.tableFilter.role !== role) return visibleLinks();
    return DATA.links;
  }

  function renderTable(role, tbody, tfoot) {
    const links = tableLinks(role);
    const own = view.tableFilter && view.tableFilter.role === role ? view.tableFilter.key : null;
    const rows = d3.rollups(links, v => d3.sum(v, l => l.vol), l => role === 'origin' ? l.o.key : l.d.key)
      .map(([key, vol]) => ({ t: DATA.byKey.get(key), vol }))
      .sort((a, b) => d3.ascending(a.t.country, b.t.country) || d3.ascending(a.t.name, b.t.name));
    tbody.replaceChildren();
    for (const { t, vol } of rows) {
      const tr = tbody.insertRow();
      tr.tabIndex = 0;
      if (own) tr.classList.add(t.key === own ? 'selected' : 'faded');
      tr.append(el('td', '', t.name), el('td', '', t.country), el('td', 'num', fmt(vol)));
      const pick = () => {
        view.selection = null;
        const same = view.tableFilter && view.tableFilter.role === role && view.tableFilter.key === t.key;
        view.tableFilter = same ? null : { role, key: t.key };
        rebuild(true);
      };
      tr.addEventListener('click', pick);
      tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    }
    tfoot.replaceChildren();
    const tr = tfoot.insertRow();
    tr.append(el('td', '', 'Total'), el('td', ''), el('td', 'num', fmt(d3.sum(rows, r => r.vol))));
  }

  function renderTables() {
    renderTable('origin', $('origin-rows'), $('origin-total'));
    renderTable('destination', $('dest-rows'), $('dest-total'));
    const chip = $('chip');
    if (view.selection) {
      $('chip-text').textContent = 'Map selection filters the tables: ' + view.selection.label;
      chip.hidden = false;
    }
    else if (view.tableFilter) {
      const t = DATA.byKey.get(view.tableFilter.key);
      $('chip-text').textContent = 'Table selection filters the map: ' + (view.tableFilter.role === 'origin' ? 'origin' : 'destination') + ' = ' + t.name;
      chip.hidden = false;
    }
    else {
      chip.hidden = true;
    }
  }

  $('chip-clear').addEventListener('click', () => {
    const hadTableFilter = !!view.tableFilter;
    view.selection = null;
    view.tableFilter = null;
    if (hadTableFilter) rebuild(true);
    else { applyHighlight(); renderTables(); }
  });

  // ---------------------------------------------------------------- controls (Format pane stand-in)

  function renderControls() {
    const root = $('controls');
    root.replaceChildren();
    for (const c of CONTROLS) {
      const group = el('div', 'ctl');
      group.hidden = c.when ? !c.when(state) : false;
      const label = el('span', 'ctl-label', c.label);
      label.id = 'ctl-' + c.key;
      const seg = el('div', 'seg');
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-labelledby', label.id);
      for (const [value, text] of c.options) {
        const b = el('button', '', text);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(state[c.key] === value));
        b.addEventListener('click', () => {
          if (state[c.key] === value) return;
          state[c.key] = value;
          saveState();
          renderControls();
          onSettingChanged(c.key);
        });
        seg.append(b);
      }
      group.append(label, seg);
      root.append(group);
    }
  }

  function onSettingChanged(key) {
    if (key === 'sample') {
      DATA = buildData(SAMPLES[state.sample]);
      view.selection = null;
      view.tableFilter = null;
      if (SEA) SEA.routes.clear(); // route cache is keyed by link id, which is per sample
      renderSummary();
      rebuild(true);
      return;
    }
    if (key === 'size') {
      visualEl.classList.toggle('large', state.size === 'large'); // ResizeObserver redraws
      return;
    }
    if (key === 'mapLabels') {
      scheduleRender();
      return;
    }
    applyTheme();
    rebuild(false);
  }

  function applyTheme() {
    const theme = THEMES[state.theme];
    const vars = {
      '--ocean': theme.ocean, '--text': theme.text, '--text-muted': theme.textMuted, '--halo': theme.halo,
      '--casing': theme.casing, '--panel': theme.panel, '--panel-border': theme.panelBorder, '--dash': theme.dash,
      '--dest': theme.dest
    };
    for (const k in vars) visualEl.style.setProperty(k, vars[k]);
    visualEl.dataset.theme = state.theme;
  }

  // ---------------------------------------------------------------- wiring

  function rebuild(fit) {
    hideTip();
    view.hover = null;
    buildModel();
    renderLegend();
    renderModelElements();
    renderTables();
    if (fit) fitToData(true);
    scheduleRender();
  }

  function renderSummary() {
    const origins = new Set(DATA.links.map(l => l.o.key)), dests = new Set(DATA.links.map(l => l.d.key));
    $('summary').textContent = DATA.title + ': ' + fmt(DATA.links.length) + ' routes · ' + origins.size + ' origins · ' +
      dests.size + ' destinations · ' + fmt(DATA.total) + ' ' + DATA.unit + ' on the map';
  }

  renderSummary();
  visualEl.classList.toggle('large', state.size === 'large');
  applyTheme();
  renderControls();
  rebuild(false);
  // The 1:10m coastlines are only needed once you zoom in; prepare them after the first paint.
  (window.requestIdleCallback || (f => setTimeout(f, 300)))(() => { ensureHiRes(); scheduleRender(); });
})();
