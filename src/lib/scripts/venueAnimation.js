/**
 * venueAnimation — the venue pulse.
 *
 * Roads light up outward from the venue in order of real driving distance:
 * a bright front sweeps through the street grid and leaves each road in its
 * band color behind it. Ends on an optional title card.
 *
 * Rendering is a pure function of time on a 2D canvas, so the same code
 * drives the live preview and a frame-exact MP4 export (WebCodecs).
 */
import tinycolor from 'tinycolor2';

export const ASPECTS = {
  wide: {label: '16:9 · LED wall', size: [1920, 1080]},
  square: {label: '1:1 · LinkedIn', size: [1080, 1080]},
  vertical: {label: '9:16 · Reels', size: [1080, 1920]},
};

export const FPS = 30;
const MAX_ZOOM = 1.08; // slow push-in over the whole clip
const GLOW_WIDTH = 0.07; // width of the bright front, in band-distance units

export function createAnimator(data, options = {}) {
  const aspect = ASPECTS[options.aspect] ? options.aspect : 'wide';
  const [W, H] = ASPECTS[aspect].size;
  const duration = options.seconds || 15;
  const titleCard = options.titleCard !== false && hasText(data.text);
  const canvas = options.canvas || document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const layout = getLayout(aspect, W, H);
  const dark = tinycolor(data.background).isDark();
  const ink = mostContrasting(data.colors, data.background);
  const glowColor = dark ? '#ffffff' : ink;
  const baseLine = Math.max(1, data.lineWidth) * Math.min(W, H) / 1080 * 1.3;

  // Timeline (seconds)
  const intro = 0.6;
  const outro = titleCard ? Math.min(4, duration * 0.3) : Math.min(1.5, duration * 0.15);
  const revealEnd = duration - outro;

  // Order segments by distance so the settled layer can be drawn incrementally.
  const order = Array.from({length: data.count}, (_, i) => i)
    .sort((a, b) => data.distance[a] - data.distance[b]);
  const sortedDistance = order.map(i => data.distance[i]);
  const frontEnd = (sortedDistance[sortedDistance.length - 1] || 1) + GLOW_WIDTH;

  // Cached layers are drawn at max zoom, then scaled down per frame (always crisp).
  const cacheSize = Math.ceil(layout.r * MAX_ZOOM * 2 + 8);
  const ghost = makeCanvas(cacheSize);
  const settled = makeCanvas(cacheSize);
  const settledCtx = settled.getContext('2d');
  let settledUpTo = 0;
  drawGhost();

  return {canvas, width: W, height: H, duration, drawFrame, reset};

  function reset() {
    settledCtx.clearRect(0, 0, cacheSize, cacheSize);
    settledUpTo = 0;
  }

  function drawFrame(t) {
    const front = frontAt(t);

    // Settle every road the front has fully passed.
    settledCtx.lineCap = 'round';
    settledCtx.lineWidth = baseLine * MAX_ZOOM;
    const settleTo = front - GLOW_WIDTH;
    if (sortedDistance[settledUpTo] !== undefined && sortedDistance[settledUpTo] <= settleTo) {
      const byBand = data.colors.map(() => []);
      while (settledUpTo < order.length && sortedDistance[settledUpTo] <= settleTo) {
        const i = order[settledUpTo++];
        byBand[data.band[i]].push(i);
      }
      byBand.forEach((ids, b) => {
        if (!ids.length) return;
        settledCtx.strokeStyle = data.colors[b];
        settledCtx.beginPath();
        ids.forEach(i => segmentPath(settledCtx, i, layout.r * MAX_ZOOM, cacheSize / 2));
        settledCtx.stroke();
      });
    }

    // Background
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = data.background;
    ctx.fillRect(0, 0, W, H);

    const zoom = 1 / MAX_ZOOM + (1 - 1 / MAX_ZOOM) * easeInOut(clamp(t / duration));
    const drawn = cacheSize * zoom;
    const x0 = layout.cx - drawn / 2;
    const y0 = layout.cy - drawn / 2;

    // Faint full street grid, so the shape of the place reads from frame one.
    ctx.globalAlpha = 0.14 * clamp(t / intro);
    ctx.drawImage(ghost, x0, y0, drawn, drawn);
    ctx.globalAlpha = 1;
    ctx.drawImage(settled, x0, y0, drawn, drawn);

    // The bright front.
    const scale = layout.r * MAX_ZOOM * zoom;
    if (front > 0 && front < frontEnd) {
      ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
      ctx.strokeStyle = glowColor;
      ctx.lineCap = 'round';
      const lo = lowerBound(sortedDistance, front - GLOW_WIDTH);
      const hi = lowerBound(sortedDistance, front);
      // Four intensity buckets: brightest right at the front.
      for (let bucket = 0; bucket < 4; ++bucket) {
        const from = front - GLOW_WIDTH * (bucket + 1) / 4;
        const to = front - GLOW_WIDTH * bucket / 4;
        ctx.globalAlpha = (1 - bucket / 4) * 0.9;
        ctx.lineWidth = baseLine * (2.4 - bucket * 0.35);
        ctx.beginPath();
        for (let k = lo; k < hi; ++k) {
          const d = sortedDistance[k];
          if (d > from && d <= to) segmentPath(ctx, order[k], scale, 0, layout.cx, layout.cy);
        }
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    drawMarker(t, layout.r * zoom);
    if (titleCard) drawTitle(t);
    drawCredit();
  }

  function frontAt(t) {
    if (t <= intro) return 0;
    const u = clamp((t - intro) / (revealEnd - intro));
    return easeInOut(u) * frontEnd;
  }

  function drawGhost() {
    const g = ghost.getContext('2d');
    g.strokeStyle = data.colors[data.colors.length - 1];
    g.lineWidth = baseLine * MAX_ZOOM * 0.8;
    g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i < data.count; ++i) segmentPath(g, i, layout.r * MAX_ZOOM, cacheSize / 2);
    g.stroke();
  }

  function segmentPath(c, i, scale, offset, cx, cy) {
    const ox = cx !== undefined ? cx : offset;
    const oy = cy !== undefined ? cy : offset;
    const k = i * 4;
    c.moveTo(ox + data.coords[k] * scale, oy + data.coords[k + 1] * scale);
    c.lineTo(ox + data.coords[k + 2] * scale, oy + data.coords[k + 3] * scale);
  }

  function drawMarker(t, r) {
    const pop = easeOutBack(clamp(t / intro));
    ctx.strokeStyle = ink;
    ctx.lineWidth = baseLine * 2;
    [0.022, 0.04].forEach(f => {
      ctx.beginPath();
      ctx.arc(layout.cx, layout.cy, r * f * pop, 0, Math.PI * 2);
      ctx.stroke();
    });
    // Sonar pulses while the roads are filling in.
    if (t > intro && t < revealEnd) {
      const period = 1.6;
      for (let n = 0; n < 2; ++n) {
        const phase = ((t - intro) / period + n / 2) % 1;
        ctx.globalAlpha = (1 - phase) * 0.6;
        ctx.lineWidth = baseLine * 1.5;
        ctx.beginPath();
        ctx.arc(layout.cx, layout.cy, r * (0.04 + phase * 0.16), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawTitle(t) {
    const fadeStart = revealEnd - 0.4;
    const a = easeInOut(clamp((t - fadeStart) / 1.2));
    if (a <= 0) return;
    const {text} = data;
    const L = layout.text;
    const rise = (1 - a) * L.size * 0.4;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = ink;
    ctx.textAlign = L.align;
    ctx.textBaseline = 'alphabetic';
    let y = L.y + rise;

    const serif = `Didot, "Bodoni 72", "Playfair Display", Georgia, serif`;
    const sans = `"Helvetica Neue", Helvetica, Arial, sans-serif`;
    if (text.event) {
      ctx.font = `italic ${Math.round(L.size * 0.42)}px ${serif}`;
      ctx.fillText(text.event, L.x, y);
      y += L.size * 1.15;
    }
    if (text.title) {
      const size = fitSize(text.title.toUpperCase(), L.size, L.maxWidth, serif, 0.12);
      ctx.font = `${Math.round(size)}px ${serif}`;
      spaced(text.title.toUpperCase(), L.x, y, size * 0.12, L.align);
      y += size * 0.75;
    }
    if (text.subtitle) {
      const size = L.size * 0.3;
      ctx.font = `${Math.round(size)}px ${sans}`;
      spaced(text.subtitle.toUpperCase(), L.x, y, size * 0.3, L.align);
      y += size * 2.2;
    }
    ctx.globalAlpha = a * 0.7;
    const cs = L.size * 0.24;
    ctx.font = `${Math.round(cs)}px ${sans}`;
    spaced(data.coordinates, L.x, y + (text.subtitle ? 0 : cs), cs * 0.25, L.align);
    ctx.restore();
  }

  function drawCredit() {
    const size = Math.max(11, Math.min(W, H) * 0.012);
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = ink;
    ctx.font = `${Math.round(size)}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText('Map data © OpenStreetMap contributors', W - size * 2, H - size * 1.8);
    ctx.restore();
  }

  function fitSize(str, size, maxWidth, family, tracking) {
    ctx.font = `${Math.round(size)}px ${family}`;
    const width = ctx.measureText(str).width + str.length * size * tracking;
    return width > maxWidth ? size * maxWidth / width : size;
  }

  // Canvas letter-spacing support is uneven, so space glyphs by hand.
  function spaced(str, x, y, tracking, align) {
    const widths = [...str].map(ch => ctx.measureText(ch).width);
    const total = widths.reduce((s, w) => s + w, 0) + tracking * (str.length - 1);
    let cursor = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    const prevAlign = ctx.textAlign;
    ctx.textAlign = 'left';
    [...str].forEach((ch, i) => {
      ctx.fillText(ch, cursor, y);
      cursor += widths[i] + tracking;
    });
    ctx.textAlign = prevAlign;
  }
}

/** Plays the animation in real time on the given canvas, looping. */
export function playPreview(data, options, canvas) {
  const animator = createAnimator(data, {...options, canvas});
  let start = null;
  let raf = 0;
  let stopped = false;
  const tick = now => {
    if (stopped) return;
    if (start === null) start = now;
    let t = (now - start) / 1000;
    if (t > animator.duration + 1) {
      start = now;
      t = 0;
      animator.reset();
    }
    animator.drawFrame(Math.min(t, animator.duration));
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return {
    animator,
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
    },
  };
}

/** Renders every frame and encodes an H.264 MP4. Resolves to a Blob. */
export async function exportVideo(data, options = {}, onProgress = () => {}) {
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('Video export needs a recent Chrome, Edge or Safari.');
  }
  // Loaded on demand: keeps the encoder out of the initial page load.
  const {Output, Mp4OutputFormat, BufferTarget, CanvasSource, QUALITY_HIGH, canEncodeVideo} = await import('mediabunny');
  const animator = createAnimator(data, options);
  const {canvas, width, height, duration} = animator;
  if (!(await canEncodeVideo('avc', {width, height}))) {
    throw new Error('This browser cannot encode H.264 at this size. Try Chrome.');
  }

  const target = new BufferTarget();
  const output = new Output({format: new Mp4OutputFormat({fastStart: 'in-memory'}), target});
  const source = new CanvasSource(canvas, {codec: 'avc', bitrate: QUALITY_HIGH, keyFrameInterval: 2});
  output.addVideoTrack(source, {frameRate: FPS});
  await output.start();

  const frames = Math.round(duration * FPS);
  for (let i = 0; i < frames; ++i) {
    const t = i / FPS;
    animator.drawFrame(t);
    await source.add(t, 1 / FPS);
    if (i % 10 === 0) onProgress(i / frames);
  }
  await output.finalize();
  onProgress(1);
  return new Blob([target.buffer], {type: 'video/mp4'});
}

function getLayout(aspect, W, H) {
  if (aspect === 'wide') {
    // Map left, editorial text block right.
    const r = H * 0.42;
    return {
      cx: W * 0.33, cy: H / 2, r,
      text: {x: W * 0.62, y: H * 0.44, size: H * 0.085, align: 'left', maxWidth: W * 0.34},
    };
  }
  if (aspect === 'vertical') {
    const r = W * 0.44;
    const cy = H * 0.38;
    return {
      cx: W / 2, cy, r,
      text: {x: W / 2, y: cy + r + H * 0.09, size: W * 0.09, align: 'center', maxWidth: W * 0.86},
    };
  }
  const r = W * 0.34;
  const cy = H * 0.41;
  return {
    cx: W / 2, cy, r,
    text: {x: W / 2, y: cy + r + H * 0.085, size: W * 0.07, align: 'center', maxWidth: W * 0.86},
  };
}

function hasText(text) {
  return Boolean(text && (text.title || text.subtitle || text.event));
}

function mostContrasting(colors, background) {
  return colors.reduce((best, c) =>
    tinycolor.readability(c, background) > tinycolor.readability(best, background) ? c : best);
}

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function lowerBound(arr, value) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < value) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function clamp(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function easeInOut(x) {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

function easeOutBack(x) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
