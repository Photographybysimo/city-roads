/**
 * driveRings — colors every road by its road-network distance from one point.
 *
 * The result is a set of concentric color bands that follow the real street
 * grid outward from a venue, a home, or any landmark. Each band is one flat
 * color, so the SVG export has exactly `bands` stroke colors — one per ink
 * for screen printing.
 *
 * Console usage (after a city is loaded):
 *
 *   let rings = driveRings({ from: { lat: 27.3364, lon: -82.5307 } });
 *   rings.setPreset('ocean');     // swap palette without recomputing
 *   rings.setBands(4);            // fewer inks
 *   rings.dispose();              // remove and restore the original city
 */
import tinycolor from 'tinycolor2';

export const PRESETS = {
  // Ordered from the center outward.
  ember:  ['#fff3b0', '#ffcf56', '#ff9f1c', '#f4743b', '#d1495b', '#7a1f3d'],
  ocean:  ['#e0fbfc', '#98dfea', '#4fb3d9', '#2a7fb8', '#1d4e89', '#0b1f4d'],
  sunset: ['#ffd6a5', '#ffadad', '#f28482', '#c06c84', '#6c5b7b', '#355c7d'],
  mono:   ['#ffffff', '#d9d9d9', '#a6a6a6', '#737373', '#404040', '#1a1a1a'],
  gold:   ['#f7e7b4', '#e8c872', '#c9a227', '#9c7a1e', '#6b5415', '#3d300c'],
};

export default function driveRings(options = {}) {
  const scene = options.scene || window.scene;
  if (!scene) throw new Error('No scene found. Load a city first.');

  const layer = scene.queryLayer();
  if (!layer || !layer.grid) throw new Error('No roads loaded yet. Load a city first.');

  const grid = layer.grid;
  const project = grid.getProjector();
  const wgl = scene.getWGL();
  const renderer = scene.getRenderer();

  let bands = clampBands(options.bands || 6);
  let palette = resolvePalette(options);
  let lineWidth = options.lineWidth || layer.lineWidth || 1;

  // 1. Build the road graph: adjacency with segment lengths in meters.
  const {adjacency, segments} = buildGraph(grid);
  if (segments.length === 0) throw new Error('This layer has no road segments.');

  // 2. Find the start node closest to `from` (defaults to map center).
  const from = options.from || {lat: grid.bounds.cy, lon: grid.bounds.cx};
  const startId = nearestNodeId(grid.nodes, adjacency, from);

  // 3. Shortest network distance from start to every reachable node.
  const dist = dijkstra(adjacency, startId);

  // 4. Cap the outermost ring so a few far-flung roads don't flatten the bands.
  const reached = [];
  dist.forEach(d => reached.push(d));
  reached.sort((a, b) => a - b);
  const maxDistance = options.maxDistance ||
    reached[Math.floor((reached.length - 1) * 0.98)] || 1;

  // 5. Draw.
  if (!options.keepScene) layer.hide();
  let lines = null;
  draw();

  const summary = {
    startNode: startId,
    reachedNodes: dist.size,
    totalNodes: adjacency.size,
    maxDistanceKm: +(maxDistance / 1000).toFixed(2),
    bandWidthKm: +(maxDistance / bands / 1000).toFixed(2),
  };
  console.log('driveRings ready', summary);

  return {
    get lines() { return lines; },
    summary,
    setPreset(name) {
      palette = resolvePalette({preset: name});
      draw();
    },
    setPalette(colors) {
      palette = resolvePalette({palette: colors});
      draw();
    },
    setBands(count) {
      bands = clampBands(count);
      draw();
    },
    setLineWidth(width) {
      lineWidth = width;
      if (lines) lines.setLineWidth(width);
      renderer.renderFrame();
    },
    dispose() {
      if (lines) renderer.removeChild(lines);
      lines = null;
      layer.show();
      renderer.renderFrame();
    },
  };

  function draw() {
    if (lines) renderer.removeChild(lines);
    const colors = interpolatePalette(palette, bands).map(toUint32);

    lines = new wgl.WireCollection(segments.length, {
      width: lineWidth,
      allowColors: true,
      is3D: false,
    });
    lines.id = 'drive-rings';

    for (const [a, b, nodeA, nodeB] of segments) {
      const da = dist.get(a);
      const db = dist.get(b);
      // Roads not connected to the start point are left out of the print.
      if (da === undefined || db === undefined) continue;

      const band = Math.min(bands - 1, Math.floor(((da + db) / 2) / maxDistance * bands));
      const color = colors[band];
      const p1 = project(nodeA);
      const p2 = project(nodeB);
      lines.add({
        from: {x: p1.x, y: p1.y, color},
        to: {x: p2.x, y: p2.y, color},
      });
    }

    renderer.appendChild(lines);
    renderer.renderFrame();
  }
}

export function buildGraph(grid) {
  const adjacency = new Map();
  const segments = [];
  const nodes = grid.nodes;

  grid.elements.forEach(element => {
    if (element.type !== 'way') return;
    const ids = element.nodes;
    for (let i = 1; i < ids.length; ++i) {
      const a = ids[i - 1];
      const b = ids[i];
      const nodeA = nodes.get(a);
      const nodeB = nodes.get(b);
      if (!nodeA || !nodeB) continue;

      const length = haversine(nodeA, nodeB);
      link(a, b, length);
      link(b, a, length);
      segments.push([a, b, nodeA, nodeB]);
    }
  });

  return {adjacency, segments};

  function link(from, to, length) {
    let edges = adjacency.get(from);
    if (!edges) adjacency.set(from, edges = []);
    edges.push(to, length);
  }
}

export function dijkstra(adjacency, startId) {
  const dist = new Map([[startId, 0]]);
  const heap = new MinHeap();
  heap.push(startId, 0);

  while (heap.size > 0) {
    const [id, d] = heap.pop();
    if (d > dist.get(id)) continue; // stale entry

    const edges = adjacency.get(id);
    if (!edges) continue;
    for (let i = 0; i < edges.length; i += 2) {
      const next = edges[i];
      const nd = d + edges[i + 1];
      const known = dist.get(next);
      if (known === undefined || nd < known) {
        dist.set(next, nd);
        heap.push(next, nd);
      }
    }
  }
  return dist;
}

export function nearestNodeId(nodes, adjacency, {lat, lon}) {
  let bestId;
  let best = Infinity;
  adjacency.forEach((_, id) => {
    const n = nodes.get(id);
    const d = (n.lat - lat) ** 2 + ((n.lon - lon) * Math.cos(lat * Math.PI / 180)) ** 2;
    if (d < best) { best = d; bestId = id; }
  });
  return bestId;
}

export function interpolatePalette(palette, count) {
  if (count === palette.length) return palette.slice();
  if (count === 1) return [palette[0]];
  const result = [];
  for (let i = 0; i < count; ++i) {
    const t = i / (count - 1) * (palette.length - 1);
    const lo = Math.floor(t);
    const hi = Math.min(palette.length - 1, lo + 1);
    result.push(tinycolor.mix(palette[lo], palette[hi], (t - lo) * 100).toHexString());
  }
  return result;
}

function resolvePalette({palette, preset}) {
  if (Array.isArray(palette) && palette.length >= 2) return palette;
  const name = preset || 'ember';
  if (!PRESETS[name]) {
    throw new Error(`Unknown preset "${name}". Try: ${Object.keys(PRESETS).join(', ')}`);
  }
  return PRESETS[name];
}

function clampBands(n) {
  return Math.max(2, Math.min(12, Math.round(n)));
}

function toUint32(color) {
  const {r, g, b, a} = tinycolor(color).toRgb();
  // w-gl expects 0xRRGGBBAA
  return ((r << 24) | (g << 16) | (b << 8) | Math.round(a * 255)) >>> 0;
}

function haversine(a, b) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

class MinHeap {
  constructor() { this.ids = []; this.keys = []; }
  get size() { return this.ids.length; }

  push(id, key) {
    const {ids, keys} = this;
    let i = ids.length;
    ids.push(id); keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p]; keys[i] = keys[p];
      i = p;
    }
    ids[i] = id; keys[i] = key;
  }

  pop() {
    const {ids, keys} = this;
    const topId = ids[0];
    const topKey = keys[0];
    const lastId = ids.pop();
    const lastKey = keys.pop();
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      while (true) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = (r < n && keys[r] < keys[l]) ? r : l;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c]; keys[i] = keys[c];
        i = c;
      }
      ids[i] = lastId; keys[i] = lastKey;
    }
    return [topId, topKey];
  }
}
