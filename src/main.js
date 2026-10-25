// The Vue build version to load with the `import` command
// (runtime-only or standalone) has been set in webpack.base.conf with an alias.
import {createApp} from 'vue';
import {require as d3Require} from 'd3-require';
import {isWebGLEnabled} from 'w-gl';
import App from './App.vue';
import NoWebGL from './NoWebGL.vue';
import Query from './lib/Query.js';
import driveRings, {PRESETS as driveRingPresets} from './lib/scripts/driveRings.js';
import venueMap from './lib/scripts/venueMap.js';
import {clearCache} from './lib/osmCache.js';

// const wgl = require('w-gl');

window.addEventListener('error', logError);

// expose the console API
window.requireModule = d3Require;
window.Query = Query;
window.driveRings = driveRings;
driveRings.presets = driveRingPresets;
window.venueMap = venueMap;
window.clearRoadCache = clearCache;

if (isWebGLEnabled(document.querySelector('#canvas'))) {
  createApp(App).mount('#host');
} else {
  createApp(NoWebGL).mount('#host');
}

function logError(e) {
  if (typeof gtag !== 'function') return;

  const exDescription = e ? `${e.message} in ${e.filename}:${e.lineno}` : 'Unknown exception';

  gtag('send', 'exception', {
    description: exDescription,
    fatal: false
  });
}