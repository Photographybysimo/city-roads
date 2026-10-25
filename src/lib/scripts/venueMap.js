/**
 * venueMap — a circular, venue-centered road map for prints and apparel.
 *
 * Loads only the roads within a radius of the venue (fast), colors them by
 * road-network distance from the venue in flat bands, marks the venue, and
 * exports a print-ready poster or tee file with typography.
 *
 * Console usage:
 *
 *   let v = await venueMap({ place: 'Ritz-Carlton Sarasota', radiusKm: 3,
 *                            event: 'Leadership Summit 2026' });
 *   v.setPreset('ocean');
 *   v.preview();                         // opens the poster in a new tab
 *   v.downloadSVG({ size: '18x24' });    // vector, for print shops
 *   v.downloadPNG({ size: '18x24' });    // 300 dpi raster, for Printful-type services
 *   v.downloadPNG({ layout: 'tee' });    // transparent 12x16 for DTG shirts
 */
import tinycolor from 'tinycolor2';
import Query from '../Query.js';
import LoadOptions from '../LoadOptions.js';
import {
  PRESETS, buildGraph, dijkstra, interpolatePalette, resolvePalette,
  clampBands, toUint32, haversine,
} from './driveRings.js';

// Poster sizes in inches, portrait.
export const SIZES = {
  '8x10': [8, 10], '11x14': [11, 14], '12x16': [12, 16],
  '16x20': [16, 20], '18x24': [18, 24], '24x36': [24, 36],
  'tee': [12, 16], // standard DTG print area
};

const UNITS_PER_INCH = 100; // SVG user units

export default async function venueMap(options = {}) {
  const scene = options.scene || window.scene;
  if (!scene) throw new Error('Scene is not ready yet. Wait for the page to finish loading.');

  // 1. Where is the venue?
  let {lat, lon} = options;
  let placeName = options.place;
  if (lat === undefined || lon === undefined) {
    if (!placeName) throw new Error('Pass either { place } or { lat, lon }.');
    const found = await geocode(placeName);
    lat = found.lat; lon = found.lon;
    placeName = found.name;
    console.log(`venueMap: found "${found.displayName}" at ${lat}, ${lon}`);
  }
  const venue = {lat: +lat, lon: +lon};

  const radiusMeters = (options.radiusKm || 3) * 1000;
  let bands = clampBands(options.bands || 5);
  let palette = resolvePalette(options);
  let background = options.background || '#0b0b0b';
  let lineWidth = options.lineWidth || 1;
  const text = {
    title: options.title !== undefined ? options.title : (placeName || ''),
    subtitle: options.subtitle || '',
    event: options.event || '',
  };

  // 2. Load only the roads inside the radius, not the whole city.
  console.log(`venueMap: loading roads within ${radiusMeters / 1000} km…`);
  const t0 = performance.now();
  const loadOptions = new LoadOptions({
    wayFilter: options.wayFilter || Query.RoadStrict,
    bbox: bboxAround(venue, radiusMeters * 1.05),
    // A small area needs seconds. A short server-side limit also means an
    // abandoned query frees its slot quickly instead of blocking the next
    // try with "too many requests" for up to 15 minutes.
    timeout: 120,
    maxHeapByteSize: 256 * 1024 * 1024,
  });
  const grid = await Query.runFromOptions(loadOptions);
  console.log(`venueMap: roads loaded in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  // 3. Network distance from the venue.
  const {adjacency, segments} = buildGraph(grid);
  if (segments.length === 0) throw new Error('No roads found around this venue. Try a bigger radiusKm.');
  const {startId, dist} = pickStart(grid.nodes, adjacency, venue);

  // 4. Keep the circle only, and size the bands to what's inside it.
  const inCircle = segments.filter(([a, b, nodeA, nodeB]) =>
    dist.has(a) && dist.has(b) &&
    haversine(venue, nodeA) <= radiusMeters && haversine(venue, nodeB) <= radiusMeters);
  const inside = inCircle.map(([a, b]) => (dist.get(a) + dist.get(b)) / 2).sort((x, y) => x - y);
  const maxDistance = options.maxDistance || inside[Math.floor((inside.length - 1) * 0.98)] || 1;

  // 5. Draw on screen.
  scene.clear();
  scene.background = background;
  const project = grid.getProjector();
  const wgl = scene.getWGL();
  const renderer = scene.getRenderer();
  const center = project(venue);
  const projectedRadius = projectedDistance(project, venue, radiusMeters);
  let lines = null;
  let marker = null;
  drawScene();
  renderer.setViewBox({
    left: center.x - projectedRadius * 1.1,
    right: center.x + projectedRadius * 1.1,
    top: center.y + projectedRadius * 1.1,
    bottom: center.y - projectedRadius * 1.1,
  });

  const summary = {
    venue,
    radiusKm: radiusMeters / 1000,
    segments: inCircle.length,
    bandWidthKm: +(maxDistance / bands / 1000).toFixed(2),
  };
  console.log('venueMap ready', summary);

  return {
    summary,
    presets: Object.keys(PRESETS),
    setPreset(name) { palette = resolvePalette({preset: name}); drawScene(); },
    setPalette(colors) { palette = resolvePalette({palette: colors}); drawScene(); },
    setBands(count) { bands = clampBands(count); drawScene(); },
    setBackground(color) { background = color; scene.background = color; },
    setLineWidth(width) {
      lineWidth = width;
      if (lines) lines.setLineWidth(width);
      renderer.renderFrame();
    },
    setText(newText) { Object.assign(text, newText); },
    toSVG: (opts) => posterSVG(opts),
    preview(opts) {
      const url = URL.createObjectURL(new Blob([posterSVG(opts)], {type: 'image/svg+xml'}));
      window.open(url, '_blank');
    },
    downloadSVG(opts = {}) {
      const svg = posterSVG(opts);
      download(new Blob([svg], {type: 'image/svg+xml'}), fileName(opts, 'svg'));
    },
    async downloadPNG(opts = {}) {
      const blob = await svgToPNG(posterSVG(opts), sizeOf(opts), opts.dpi || 300);
      download(blob, fileName(opts, 'png'));
    },
    dispose() {
      if (lines) renderer.removeChild(lines);
      if (marker) renderer.removeChild(marker);
      renderer.renderFrame();
    },
  };

  function bandColors(bg = background) {
    return ensureContrast(interpolatePalette(palette, bands), bg);
  }

  function bandOf(a, b) {
    const d = (dist.get(a) + dist.get(b)) / 2;
    return Math.min(bands - 1, Math.floor(d / maxDistance * bands));
  }

  function drawScene() {
    if (lines) renderer.removeChild(lines);
    if (marker) renderer.removeChild(marker);
    const colors = bandColors().map(toUint32);

    lines = new wgl.WireCollection(inCircle.length, {width: lineWidth, allowColors: true, is3D: false});
    lines.id = 'venue-map';
    for (const [a, b, nodeA, nodeB] of inCircle) {
      const color = colors[bandOf(a, b)];
      const p1 = project(nodeA);
      const p2 = project(nodeB);
      lines.add({from: {x: p1.x, y: p1.y, color}, to: {x: p2.x, y: p2.y, color}});
    }

    // Venue marker: two small concentric rings in the center color.
    marker = new wgl.WireCollection(128, {width: 2, allowColors: true, is3D: false});
    marker.id = 'venue-marker';
    const markerColor = toUint32(bandColors()[0]);
    [0.018, 0.032].forEach(r => addCircle(marker, center, projectedRadius * r, markerColor));

    renderer.appendChild(lines);
    renderer.appendChild(marker);
    renderer.renderFrame();
  }

  function posterSVG(opts = {}) {
    const layout = opts.layout || (opts.size === 'tee' ? 'tee' : 'poster');
    const [wIn, hIn] = sizeOf(opts);
    const W = wIn * UNITS_PER_INCH;
    const H = hIn * UNITS_PER_INCH;
    const isTee = layout === 'tee';
    const bg = isTee ? (opts.background || null) : (opts.background || background);
    // Tees print on fabric: check contrast against the garment color.
    const colors = bandColors(bg || opts.garment || '#ffffff');
    const ink = opts.textColor || mostContrasting(colors, bg || opts.garment || '#ffffff');

    const margin = (isTee ? 0.5 : 1.2) * UNITS_PER_INCH;
    const diameter = W - 2 * margin;
    const cx = W / 2;
    const cy = margin + diameter / 2;
    const scale = (diameter / 2) / projectedRadius;
    const strokePt = opts.strokeWidth || (isTee ? 1.2 : 0.8); // points
    const stroke = strokePt / 72 * UNITS_PER_INCH;

    // One path per band: one stroke color per ink.
    const paths = colors.map(() => []);
    const last = colors.map(() => null);
    for (const [a, b, nodeA, nodeB] of inCircle) {
      const band = bandOf(a, b);
      const p1 = project(nodeA);
      const p2 = project(nodeB);
      const x1 = r1(cx + (p1.x - center.x) * scale), y1 = r1(cy - (p1.y - center.y) * scale);
      const x2 = r1(cx + (p2.x - center.x) * scale), y2 = r1(cy - (p2.y - center.y) * scale);
      const prev = last[band];
      if (prev && prev[0] === x1 && prev[1] === y1) paths[band].push(`L${x2} ${y2}`);
      else paths[band].push(`M${x1} ${y1}L${x2} ${y2}`);
      last[band] = [x2, y2];
    }

    const textTop = cy + diameter / 2 + (isTee ? 0.6 : 0.9) * UNITS_PER_INCH;
    // Title scales with the print, then shrinks if a long name would overflow.
    let titleSize = UNITS_PER_INCH * (isTee ? 0.8 : 1.0) * Math.min(1, W / (18 * UNITS_PER_INCH));
    const titleWidth = (text.title || '').length * titleSize * (0.72 + 0.18);
    if (titleWidth > diameter) titleSize *= diameter / titleWidth;
    const smallSize = Math.max(titleSize, UNITS_PER_INCH * 0.5 * Math.min(1, W / (18 * UNITS_PER_INCH))) * 0.36;
    const serif = `Didot, 'Bodoni 72', 'Playfair Display', Georgia, serif`;
    const sans = `'Helvetica Neue', Helvetica, Arial, sans-serif`;

    const textLines = [];
    let y = textTop;
    if (text.title) {
      textLines.push(textEl(text.title.toUpperCase(), y, titleSize, serif, 0.18, 400));
      y += titleSize * 0.95;
    }
    if (text.subtitle) {
      textLines.push(textEl(text.subtitle.toUpperCase(), y, smallSize, sans, 0.35, 400));
      y += smallSize * 1.9;
    }
    if (text.event) {
      textLines.push(textEl(text.event, y, smallSize * 1.15, serif, 0.06, 400, 'italic'));
      y += smallSize * 2;
    }
    if (!isTee || opts.coordinates) {
      textLines.push(textEl(formatCoords(venue), y, smallSize * 0.85, sans, 0.3, 400));
    }
    const credit = textEl('Map data © OpenStreetMap contributors',
      H - margin * 0.45, smallSize * 0.55, sans, 0.15, 400, 'normal', 0.6);

    const mk = (radius, sw) => `<circle cx="${cx}" cy="${cy}" r="${r1(diameter / 2 * radius)}" fill="none" stroke="${ink}" stroke-width="${r1(stroke * sw)}"/>`;

    return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generator: city-roads venueMap. Data © OpenStreetMap contributors, ODbL 1.0. https://osm.org/copyright -->
<svg xmlns="http://www.w3.org/2000/svg" width="${wIn}in" height="${hIn}in" viewBox="0 0 ${W} ${H}">
${bg ? `<rect width="${W}" height="${H}" fill="${bg}"/>` : ''}
<g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="${r1(stroke)}">
${paths.map((d, i) => d.length ? `<path stroke="${colors[i]}" d="${d.join('')}"/>` : '').join('\n')}
</g>
${mk(0.018, 2.5)}${mk(0.032, 1.5)}
${textLines.join('\n')}
${credit}
</svg>`;

    function textEl(content, ty, size, family, tracking, weight, style = 'normal', opacity = 1) {
      return `<text x="${cx}" y="${r1(ty)}" text-anchor="middle" fill="${ink}" fill-opacity="${opacity}" font-family="${family}" font-size="${r1(size)}" font-weight="${weight}" font-style="${style}" letter-spacing="${r1(size * tracking)}">${escapeXml(content)}</text>`;
    }
  }

  function fileName(opts, ext) {
    const slug = (text.title || 'venue').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const size = opts.layout === 'tee' ? 'tee' : (opts.size || '18x24');
    return `${slug}-${size}.${ext}`;
  }
}

/**
 * Nudges each band color until it reads against the background (WCAG 3:1,
 * the bar for graphics). Stops a dark outer ring vanishing on a black poster,
 * or a pale center vanishing on a white shirt.
 */
export function ensureContrast(colors, background, minRatio = 3) {
  const bg = tinycolor(background);
  const darkBg = bg.isDark();
  return colors.map(c => {
    let color = tinycolor(c);
    for (let i = 0; i < 20 && tinycolor.readability(color, bg) < minRatio; ++i) {
      color = darkBg ? color.lighten(4) : color.darken(4);
    }
    return color.toHexString();
  });
}

function mostContrasting(colors, background) {
  return colors.reduce((best, c) =>
    tinycolor.readability(c, background) > tinycolor.readability(best, background) ? c : best);
}

function sizeOf(opts) {
  const key = opts.layout === 'tee' ? 'tee' : (opts.size || '18x24');
  const size = SIZES[key];
  if (!size) throw new Error(`Unknown size "${key}". Try: ${Object.keys(SIZES).join(', ')}`);
  return size;
}

/**
 * The nearest node can sit on an isolated driveway or parking aisle that the
 * radius cut off from the road network. Try the closest few nodes and use
 * the first one that reaches most of the map.
 */
function pickStart(nodes, adjacency, venue) {
  const candidates = [];
  adjacency.forEach((_, id) => {
    const n = nodes.get(id);
    candidates.push([id, haversine(venue, n)]);
  });
  candidates.sort((a, b) => a[1] - b[1]);

  let best = null;
  for (const [id] of candidates.slice(0, 15)) {
    const dist = dijkstra(adjacency, id);
    if (!best || dist.size > best.dist.size) best = {startId: id, dist};
    if (dist.size >= adjacency.size * 0.5) break;
  }
  return best;
}

function geocode(query) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(query);
  return fetch(url).then(r => r.json()).then(results => {
    if (!results || !results[0]) throw new Error(`Could not find "${query}". Try { lat, lon } instead.`);
    const r = results[0];
    return {
      lat: +r.lat,
      lon: +r.lon,
      name: (r.name || r.display_name.split(',')[0]).trim(),
      displayName: r.display_name,
    };
  });
}

function bboxAround({lat, lon}, meters) {
  const dLat = meters / 111320;
  const dLon = meters / (111320 * Math.cos(lat * Math.PI / 180));
  // south, west, north, east — the order LoadOptions expects
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map(x => x.toFixed(6));
}

function projectedDistance(project, venue, meters) {
  const a = project(venue);
  const b = project({lat: venue.lat + meters / 111320, lon: venue.lon});
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function addCircle(collection, c, r, color) {
  const steps = 48;
  for (let i = 0; i < steps; ++i) {
    const t1 = i / steps * Math.PI * 2;
    const t2 = (i + 1) / steps * Math.PI * 2;
    collection.add({
      from: {x: c.x + r * Math.cos(t1), y: c.y + r * Math.sin(t1), color},
      to: {x: c.x + r * Math.cos(t2), y: c.y + r * Math.sin(t2), color},
    });
  }
}

function formatCoords({lat, lon}) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${ns}  ·  ${Math.abs(lon).toFixed(4)}° ${ew}`;
}

function svgToPNG(svg, [wIn, hIn], dpi) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], {type: 'image/svg+xml'}));
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(wIn * dpi);
      canvas.height = Math.round(hIn * dpi);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG too large for this browser. Try a lower dpi.')), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not render the poster.')); };
    img.src = url;
  });
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function r1(x) {
  return Math.round(x * 10) / 10;
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
