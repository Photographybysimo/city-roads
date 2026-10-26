<template>
<div class='venue-panel shadow'>
  <div class='panel-head'>
    <strong>Venue map</strong>
    <a href='#' @click.prevent='$emit("start-over")'>New venue</a>
  </div>

  <section>
    <h4>Text</h4>
    <input v-model='title' @input='syncText' placeholder='Title'>
    <input v-model='subtitle' @input='syncText' placeholder='Subtitle, e.g. Sarasota, Florida'>
    <input v-model='event' @input='syncText' placeholder='Event, e.g. Leadership Summit 2026'>
  </section>

  <section>
    <h4>Colors</h4>
    <div class='presets'>
      <button v-for='(colors, name) in presets' :key='name' :class='{active: preset === name}'
        @click='setPreset(name)' :title='name'>
        <span class='swatch' :style='{background: gradient(colors)}'></span>
        <span class='name'>{{name}}</span>
      </button>
    </div>
    <div class='row-inline'>
      <span>Bands</span>
      <div class='chips'>
        <button v-for='n in [3, 4, 5, 6, 8]' :key='n' :class='{active: bands === n}' @click='setBands(n)'>{{n}}</button>
      </div>
    </div>
    <div class='row-inline'>
      <span>Background</span>
      <div class='chips'>
        <button v-for='bg in backgrounds' :key='bg.color' :class='{active: background === bg.color}'
          @click='setBackground(bg.color)'>{{bg.name}}</button>
      </div>
    </div>
    <div class='row-inline'>
      <span>Line width</span>
      <input type='range' min='0.5' max='4' step='0.5' v-model.number='lineWidth' @input='controller.setLineWidth(lineWidth)'>
    </div>
  </section>

  <section>
    <h4>Poster</h4>
    <div class='row-inline'>
      <span>Size</span>
      <select v-model='size'>
        <option v-for='s in posterSizes' :key='s' :value='s'>{{s}} in</option>
      </select>
    </div>
    <div class='actions'>
      <button @click='controller.preview({size})'>Preview</button>
      <button class='primary' @click='run(() => controller.downloadPNG({size}), "PNG")'>PNG · 300 dpi</button>
      <button @click='controller.downloadSVG({size})'>SVG</button>
    </div>
  </section>

  <section>
    <h4>T-shirt</h4>
    <div class='row-inline'>
      <span>Shirt</span>
      <div class='chips'>
        <button v-for='g in garments' :key='g.color' :class='{active: garment === g.color}'
          @click='garment = g.color'>
          <span class='dot' :style='{background: g.color}'></span>{{g.name}}
        </button>
      </div>
    </div>
    <div class='actions'>
      <button @click='controller.preview({layout: "tee", background: garment})'>Preview on shirt</button>
      <button class='primary' @click='run(() => controller.downloadPNG({layout: "tee", garment}), "tee PNG")'>Print file (PNG)</button>
    </div>
    <p class='note'>The print file has a transparent background. Colors are tuned to show on the shirt color you pick.</p>
  </section>

  <section>
    <h4>Motion · venue pulse</h4>
    <div class='row-inline'>
      <span>Format</span>
      <div class='chips'>
        <button v-for='(a, key) in aspects' :key='key' :class='{active: aspect === key}'
          @click='aspect = key' :title='a.label'>{{a.label.split(" · ")[0]}}</button>
      </div>
    </div>
    <div class='row-inline'>
      <span>Length</span>
      <div class='chips'>
        <button v-for='sec in [10, 15, 30]' :key='sec' :class='{active: seconds === sec}'
          @click='seconds = sec'>{{sec}}s</button>
      </div>
    </div>
    <label class='row-inline check'>
      <span>Title card</span>
      <input type='checkbox' v-model='titleCard'>
    </label>
    <div class='actions'>
      <button @click='openPreview' :disabled='exporting'>Play preview</button>
      <button class='primary' @click='exportMP4' :disabled='exporting'>
        {{exporting ? `Rendering ${Math.round(exportProgress * 100)}%` : 'Export MP4'}}
      </button>
    </div>
    <p class='note'>{{aspects[aspect].label}}. Renders frame by frame at 30 fps, faster than real time on most Macs.</p>
  </section>

  <p v-if='message' class='note status'>{{message}}</p>

  <div v-if='previewOpen' class='video-preview' @click.self='closePreview'>
    <div class='frame'>
      <canvas ref='previewCanvas'></canvas>
      <div class='preview-actions'>
        <button @click='closePreview'>Close</button>
        <button class='primary' @click='closePreview(); exportMP4()'>Export this MP4</button>
      </div>
    </div>
  </div>
  <p class='note'>{{controller.summary.segments.toLocaleString()}} road segments · each band ≈ {{controller.summary.bandWidthKm}} km of driving</p>
</div>
</template>

<script>
import {PRESETS} from '../lib/scripts/driveRings.js';
import {SIZES} from '../lib/scripts/venueMap.js';
import {ASPECTS, playPreview, exportVideo} from '../lib/scripts/venueAnimation.js';

export default {
  name: 'VenuePanel',
  props: {
    controller: {type: Object, required: true},
    initialPreset: {type: String, default: 'gold'},
  },
  emits: ['start-over', 'background'],
  data() {
    const text = this.controller.text;
    const state = this.controller.state;
    return {
      presets: PRESETS,
      preset: this.initialPreset,
      bands: state.bands,
      background: state.background,
      lineWidth: state.lineWidth,
      title: text.title,
      subtitle: text.subtitle,
      event: text.event,
      size: '18x24',
      posterSizes: Object.keys(SIZES).filter(s => s !== 'tee'),
      garment: '#ffffff',
      aspects: ASPECTS,
      aspect: 'wide',
      seconds: 15,
      titleCard: true,
      previewOpen: false,
      exporting: false,
      exportProgress: 0,
      message: '',
      backgrounds: [
        {name: 'Black', color: '#0b0b0b'},
        {name: 'Navy', color: '#0f1b2d'},
        {name: 'Cream', color: '#f4f1ea'},
        {name: 'White', color: '#ffffff'},
      ],
      garments: [
        {name: 'White', color: '#ffffff'},
        {name: 'Black', color: '#111111'},
        {name: 'Navy', color: '#1c2841'},
        {name: 'Natural', color: '#efe8d8'},
      ],
    };
  },
  mounted() {
    this.$emit('background', this.background);
  },
  beforeUnmount() {
    this.closePreview();
  },
  methods: {
    motionOptions() {
      return {aspect: this.aspect, seconds: this.seconds, titleCard: this.titleCard};
    },
    openPreview() {
      this.previewOpen = true;
      this.$nextTick(() => {
        this.player = playPreview(this.controller.getRenderData(), this.motionOptions(), this.$refs.previewCanvas);
      });
    },
    closePreview() {
      if (this.player) this.player.stop();
      this.player = null;
      this.previewOpen = false;
    },
    async exportMP4() {
      if (this.exporting) return;
      this.exporting = true;
      this.exportProgress = 0;
      this.message = 'Rendering video… keep this tab in front until it finishes.';
      try {
        const blob = await exportVideo(this.controller.getRenderData(), this.motionOptions(),
          p => { this.exportProgress = p; });
        const slug = (this.title || 'venue').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${slug}-pulse-${this.aspect}-${this.seconds}s.mp4`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
        this.message = `MP4 downloaded (${(blob.size / 1e6).toFixed(1)} MB).`;
      } catch (e) {
        this.message = e.message || String(e);
      } finally {
        this.exporting = false;
      }
    },
    gradient(colors) {
      return `linear-gradient(90deg, ${colors.join(', ')})`;
    },
    syncText() {
      this.controller.setText({title: this.title, subtitle: this.subtitle, event: this.event});
    },
    setPreset(name) {
      this.preset = name;
      this.controller.setPreset(name);
    },
    setBands(n) {
      this.bands = n;
      this.controller.setBands(n);
    },
    setBackground(color) {
      this.background = color;
      this.controller.setBackground(color);
      this.$emit('background', color);
    },
    async run(action, label) {
      this.message = `Rendering ${label}… large sizes take a few seconds.`;
      try {
        await action();
        this.message = `${label} downloaded.`;
      } catch (e) {
        this.message = e.message || String(e);
      }
    },
  },
};
</script>

<style lang='stylus'>
@import('../vars.styl');

.venue-panel {
  position: absolute;
  z-index: 2;
  top: 8px;
  left: 8px;
  width: 384px;
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  background: white;
  padding: 12px 14px;
  font-size: 14px;
  color: primary-text;

  .panel-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }
  section {
    border-top: 1px solid border-color;
    padding: 10px 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  h4 {
    margin: 0;
    font-weight: normal;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: secondary-color;
  }
  input:not([type=range]), select {
    font-family: inherit;
    font-size: 14px;
    padding: 6px 8px;
    border: 1px solid border-color;
    outline: none;
    &:focus {
      border-color: highlight-color;
    }
  }
  button {
    font-family: inherit;
    font-size: 13px;
    padding: 6px 10px;
    border: 1px solid border-color;
    background: white;
    color: primary-text;
    cursor: pointer;
    white-space: nowrap;
    &.active {
      border-color: highlight-color;
      color: highlight-color;
    }
    &.primary {
      background: highlight-color;
      border-color: highlight-color;
      color: white;
    }
  }
  .presets {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 6px;
    button {
      padding: 4px;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 4px;
    }
    .swatch {
      height: 18px;
    }
    .name {
      font-size: 11px;
      text-transform: capitalize;
    }
  }
  .row-inline {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    > span {
      color: secondary-color;
      font-size: 13px;
      min-width: 64px;
    }
  }
  .chips {
    display: flex;
    flex-wrap: nowrap;
    gap: 4px;
    justify-content: flex-end;
  }
  .dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1px solid #ccc;
    margin-right: 4px;
    vertical-align: -1px;
  }
  .actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .note {
    font-size: 12px;
    color: secondary-color;
    margin: 0;
  }
  .status {
    color: highlight-color;
    padding-top: 6px;
  }
}

.venue-panel .check input {
  width: 18px;
  height: 18px;
}

.video-preview {
  position: fixed;
  inset: 0;
  z-index: 10;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  .frame {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }
  canvas {
    max-width: 88vw;
    max-height: 80vh;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  }
  .preview-actions {
    display: flex;
    gap: 8px;
  }
}

@media (max-width: small-screen) {
  .venue-panel {
    left: 0;
    top: auto;
    bottom: 0;
    width: 100%;
    max-height: 50vh;
  }
}
</style>
