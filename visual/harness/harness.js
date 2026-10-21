/* Test harness: a stand-in Power BI host that builds data views the way Power BI does for this
 * visual's capabilities.json, so the packaged build can be exercised and screenshotted in a browser.
 *
 * URL parameters:
 *   data=us-2024|me-2025   color=product (Color by)   canal=1 (bind Canal transit)
 *   w, h                   viewport size
 *   o.<card>.<property>=v  Format pane value, e.g. o.flowStyle.style=arc, o.map.theme=light
 *   hover=1                hover the widest flow and show the tooltip
 *   click=1                click the widest flow (selection / cross-filter)
 */
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const logEl = document.getElementById('log');
  const log = (...a) => { logEl.textContent += a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\n'; };
  window.addEventListener('error', e => log('ERROR', e.message, (e.filename || '').split('/').pop() + ':' + e.lineno));
  window.addEventListener('unhandledrejection', e => log('REJECTION', String(e.reason)));

  // ---------------------------------------------------------------- fake host
  const PALETTE = ['#118DFF', '#12239E', '#E66C37', '#6B007B', '#E044A7', '#744EC2', '#D9B300', '#D64550'];
  const assigned = new Map();
  const colorPalette = {
    isHighContrast: false,
    foreground: { value: '#000000' }, background: { value: '#ffffff' }, foregroundSelected: { value: '#000000' },
    getColor(key) {
      if (!assigned.has(key)) assigned.set(key, PALETTE[assigned.size % PALETTE.length]);
      return { value: assigned.get(key) };
    }
  };
  function selectionId(key) {
    return {
      getKey: () => key, getSelector: () => ({ data: [{ key }] }), equals: o => o && o.getKey && o.getKey() === key,
      includes: o => o && o.getKey && o.getKey() === key, hasIdentity: () => true, getSelectorsByColumn: () => ({})
    };
  }
  function idBuilder() {
    const parts = [];
    return {
      withCategory(cat, i) { parts.push('cat:' + i); return this; },
      withSeries(values, group) { parts.push('series:' + (group && group.name !== undefined ? group.name : '')); return this; },
      withMeasure(m) { parts.push('m:' + m); return this; },
      createSelectionId() { return selectionId(parts.join('|')); }
    };
  }
  let selected = [], onSelect = null;
  const tooltipEl = document.getElementById('tooltip');
  const host = {
    eventService: {
      renderingStarted: () => log('renderingStarted'),
      renderingFinished: () => log('renderingFinished'),
      renderingFailed: (o, reason) => log('renderingFailed', reason)
    },
    createSelectionManager: () => ({
      registerOnSelectCallback(f) { onSelect = f; },
      select(ids, multi) {
        ids = Array.isArray(ids) ? ids : [ids];
        selected = multi ? selected.concat(ids) : ids;
        log('select', selected.length + ' ids (cross-filter)');
        return Promise.resolve(selected);
      },
      clear() { selected = []; log('selection cleared'); return Promise.resolve(); },
      getSelectionIds: () => selected,
      hasSelection: () => selected.length > 0,
      showContextMenu(id, pos) { log('contextMenu', pos); return Promise.resolve(); }
    }),
    createSelectionIdBuilder: idBuilder,
    colorPalette,
    tooltipService: {
      enabled: () => true,
      show(o) {
        tooltipEl.replaceChildren();
        const header = o.dataItems[0] && o.dataItems[0].header;
        if (header) { const b = document.createElement('b'); b.textContent = header; tooltipEl.append(b); }
        for (const it of o.dataItems) {
          const row = document.createElement('div');
          row.textContent = it.displayName + ': ' + it.value;
          tooltipEl.append(row);
        }
        tooltipEl.style.left = (o.coordinates[0] + 12) + 'px';
        tooltipEl.style.top = (o.coordinates[1] + 12) + 'px';
        tooltipEl.style.display = 'block';
        log('tooltip', o.dataItems.map(i => i.displayName + '=' + i.value).join(' | '));
      },
      move(o) {
        // Power BI re-renders the tooltip from these items on every move; an empty list blanks it.
        if (!o.dataItems || !o.dataItems.length) log('ERROR tooltip move without items (would blank the tooltip)');
        tooltipEl.style.left = (o.coordinates[0] + 12) + 'px'; tooltipEl.style.top = (o.coordinates[1] + 12) + 'px';
      },
      hide() { tooltipEl.style.display = 'none'; }
    },
    hostCapabilities: { allowInteractions: true },
    persistProperties: () => {},
    locale: 'en-US'
  };

  // ---------------------------------------------------------------- data view, shaped like capabilities.json
  const dataset = window.HARNESS_DATA && window.HARNESS_DATA[params.get('data') || 'us-2024'];
  if (!dataset) { log('ERROR no dataset; run tools/make-harness-data.mjs'); return; }
  const byColor = params.get('color') === 'product', withCanal = params.get('canal') === '1';

  // Categories are the unique (origin, coords, destination, coords[, canal]) combinations, like Power BI's grouping.
  const rowIndex = new Map(), rows = [];
  for (const [o, olat, olon, d, dlat, dlon, canal, product, vol] of dataset.rows) {
    const key = [o, olat, olon, d, dlat, dlon, withCanal ? canal : ''].join('\u0001');
    let i = rowIndex.get(key);
    if (i === undefined) { rowIndex.set(key, i = rows.length); rows.push({ cats: [o, olat, olon, d, dlat, dlon, canal], vols: new Map() }); }
    const series = byColor ? product : '';
    rows[i].vols.set(series, (rows[i].vols.get(series) || 0) + vol);
  }
  const catRoles = ['origin', 'originLat', 'originLon', 'destination', 'destLat', 'destLon'].concat(withCanal ? ['canal'] : []);
  const catNames = { origin: 'Origin', originLat: 'Origin latitude', originLon: 'Origin longitude', destination: 'Destination', destLat: 'Destination latitude', destLon: 'Destination longitude', canal: 'Canal transit' };
  const categories = catRoles.map((role, c) => ({
    source: { displayName: catNames[role], queryName: 't.' + role, roles: { [role]: true }, index: c },
    values: rows.map(r => r.cats[c]),
    identity: rows.map((_, i) => ({ key: 'row:' + i }))
  }));
  const seriesNames = [...new Set([].concat(...rows.map(r => [...r.vols.keys()])))].sort();
  const objects = {};
  for (const [k, v] of params) {
    if (!k.startsWith('o.')) continue;
    const [, card, prop] = k.split('.');
    objects[card] = objects[card] || {};
    objects[card][prop] = v === 'true' ? true : v === 'false' ? false : /^-?\d+(\.\d+)?$/.test(v) ? +v : /^#[0-9a-f]{6}$/i.test(v) ? { solid: { color: v } } : v;
  }
  const volumeSource = (name) => ({ displayName: 'Volume (bbl)', queryName: 't.volume', roles: { volume: true }, format: '#,0', groupName: name });
  const columns = seriesNames.map(name => ({ source: volumeSource(byColor ? name : undefined), values: rows.map(r => r.vols.has(name) ? r.vols.get(name) : null) }));
  const values = columns.slice();
  values.grouped = () => seriesNames.map((name, g) => ({ name: byColor ? name : undefined, identity: { key: 'series:' + name }, values: [columns[g]] }));
  if (byColor) values.source = { displayName: 'Product', queryName: 't.product', roles: { color: true } };
  const dataView = { metadata: { columns: [], objects }, categorical: { categories, values } };

  // ---------------------------------------------------------------- run
  const W = +(params.get('w') || 1000), H = +(params.get('h') || 560);
  const frame = document.getElementById('frame');
  frame.style.width = W + 'px';
  frame.style.height = H + 'px';
  const element = document.createElement('div');
  element.style.cssText = 'position:absolute;inset:0';
  frame.prepend(element);
  const plugin = Object.values(window.powerbi.visuals.plugins)[0];
  const visual = plugin.create({ element, host });
  const update = (w, h) => visual.update({ dataViews: [dataView], viewport: { width: w, height: h }, type: 2 });
  const t0 = performance.now();
  update(W, H);
  log('data', dataset.title, rows.length + ' rows,', seriesNames.length + ' series; first update ' + Math.round(performance.now() - t0) + ' ms');
  update(W, H); // a second update with unchanged data must not rebuild or refit
  const fm = visual.getFormattingModel();
  log('formatPane', fm.cards.map(c => c.displayName + '(' + c.groups.reduce((n, g) => n + g.slices.length, 0) + ')').join(', '));

  setTimeout(() => {
    const hits = [...document.querySelectorAll('.wfm-hit')];
    log('dom', hits.length + ' flow segments, ' + document.querySelectorAll('.wfm-term').length + ' terminals, ' +
      [...document.querySelectorAll('.wfm-label')].filter(l => l.style.display !== 'none').length + ' labels shown');
    const widest = hits[0];
    const dimmed = () => document.querySelector('.wfm-hl') ? document.querySelectorAll('.wfm-flow:not(.wfm-on)').length : 0;
    if (widest && params.get('hover') === '1') {
      const r = widest.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      widest.dispatchEvent(new MouseEvent('mouseover', { clientX: x, clientY: y, bubbles: true }));
      requestAnimationFrame(() => requestAnimationFrame(() => {
        widest.dispatchEvent(new MouseEvent('mousemove', { clientX: x + 5, clientY: y + 3, bubbles: true }));
        log('hover', 'tooltip visible=' + (tooltipEl.style.display === 'block') + ', dimmed ' + dimmed() + ' of ' + document.querySelectorAll('.wfm-flow').length);
      }));
    }
    if (widest && params.get('click') === '1') {
      widest.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      setTimeout(() => log('after click', 'selected ids=' + selected.length + ', dimmed ' + dimmed() + ' of ' + document.querySelectorAll('.wfm-flow').length), 50);
    }
    if (params.get('perf') === '1') runPerf(hits);
    setTimeout(() => { document.body.dataset.done = '1'; }, 200);
  }, 400);

  // Hover: time from mouseover to the highlight being applied (one frame). Zoom: frame times while
  // a burst of wheel events drives d3-zoom, as a user scrolling would.
  function runPerf(hits) {
    const svg = document.querySelector('svg.wfm-overlay');
    const sample = hits.filter((_, i) => i % Math.max(1, Math.floor(hits.length / 40)) === 0).slice(0, 40);
    const hoverTimes = [];
    let i = 0;
    const nextHover = () => {
      if (i >= sample.length) {
        hoverTimes.sort((a, b) => a - b);
        log('perf hover', sample.length + ' changes, median ' + hoverTimes[hoverTimes.length >> 1].toFixed(1) + ' ms, max ' + hoverTimes[hoverTimes.length - 1].toFixed(1) + ' ms');
        return setTimeout(zoomBurst, 50);
      }
      const t0 = performance.now();
      sample[i++].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      requestAnimationFrame(() => { hoverTimes.push(performance.now() - t0); setTimeout(nextHover, 0); });
    };
    const zoomBurst = () => {
      const r = svg.getBoundingClientRect(), frames = [];
      let last = performance.now(), n = 0;
      const tick = now => { frames.push(now - last); last = now; if (++n < 30) requestAnimationFrame(tick); else done(); };
      for (let k = 0; k < 30; k++) {
        setTimeout(() => svg.dispatchEvent(new WheelEvent('wheel', { deltaY: k < 15 ? -40 : 40, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true })), k * 16);
      }
      requestAnimationFrame(tick);
      const done = () => {
        frames.sort((a, b) => a - b);
        log('perf zoom', '30 frames, median ' + frames[15].toFixed(1) + ' ms, worst ' + frames[29].toFixed(1) + ' ms');
      };
    };
    nextHover();
  }
})();
