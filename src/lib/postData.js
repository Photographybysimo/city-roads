import Progress from './Progress.js';
import {getCached, setCached} from './osmCache.js';

// Ordered by reliability. The first two are asked at the same time.
let backends = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
  'https://overpass.openstreetmap.ru/cgi/interpreter'
];

const START_PARALLEL = 2;     // servers asked immediately
const HEDGE_AFTER_MS = 20000; // ask one more server if nobody has answered by then

/**
 * Runs an Overpass query.
 *
 * Speed-ups over the original sequential failover:
 * 1. Cache: identical queries are served from IndexedDB.
 * 2. Race: two mirrors are asked at once; the first to answer wins and the
 *    others are aborted.
 * 3. Hedge: a server that hangs (no error, no answer) no longer blocks the
 *    load. Every 20s another mirror joins, and any failure brings in the
 *    next one straight away.
 */
export default function postData(data, progress) {
  progress = progress || new Progress();

  return getCached(data).then(cached => {
    if (cached) {
      progress.notify({loaded: 0, lengthComputable: false, fromCache: true});
      return cached;
    }
    return race(data, progress).then(result => {
      setCached(data, result); // fire and forget
      return result;
    });
  });
}

function race(data, progress) {
  return new Promise((resolve, reject) => {
    const controllers = [];
    let nextIndex = 0;
    let inFlight = 0;
    let settled = false;
    let lastError = null;
    let hedgeTimer = null;
    let winner = null;

    progress.onCancel(cancelAll);

    for (let i = 0; i < START_PARALLEL; ++i) launchNext();
    scheduleHedge();

    function launchNext() {
      if (settled || nextIndex >= backends.length) return false;
      const url = backends[nextIndex++];
      const controller = new AbortController();
      controllers.push(controller);
      inFlight += 1;

      fetch(url, {
        method: 'POST',
        headers: {'Content-type': 'application/x-www-form-urlencoded; charset=UTF-8'},
        body: 'data=' + encodeURIComponent(data),
        signal: controller.signal,
      }).then(res => {
        if (!res.ok) {
          throw {statusError: res.status, message: `Unexpected status code ${res.status} when calling ${url}`};
        }
        if (settled) return;
        // First server to start answering wins. Stop the others.
        settled = true;
        winner = controller;
        clearTimeout(hedgeTimer);
        controllers.forEach(c => { if (c !== controller) c.abort(); });
        return readJSON(res, progress).then(json => {
          progress.offCancel(cancelAll);
          resolve(json);
        });
      }).catch(err => {
        inFlight -= 1;
        if (err && err.name === 'AbortError') {
          if (progress.isCancelled) rejectOnce({cancelled: true});
          return;
        }
        if (settled) {
          // Only the winner's failure matters once a winner exists.
          if (controller === winner) {
            progress.offCancel(cancelAll);
            reject(err);
          }
          return;
        }
        lastError = err;
        if (err && err.statusError) progress.notify({loaded: -1});
        if (!launchNext() && inFlight === 0) {
          const finalError = lastError instanceof Error ? lastError : Object.assign(new Error(lastError && lastError.message || 'All servers failed'), lastError);
          finalError.allServersFailed = true;
          finalError.serversAttempted = nextIndex;
          rejectOnce(finalError);
        }
      });
      return true;
    }

    function scheduleHedge() {
      hedgeTimer = setTimeout(() => {
        if (settled) return;
        if (launchNext()) scheduleHedge();
      }, HEDGE_AFTER_MS);
    }

    function cancelAll() {
      controllers.forEach(c => c.abort());
      rejectOnce({cancelled: true});
    }

    function rejectOnce(err) {
      if (settled && !err.cancelled) return;
      settled = true;
      clearTimeout(hedgeTimer);
      progress.offCancel(cancelAll);
      reject(err);
    }
  });
}

function readJSON(res, progress) {
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !res.body.getReader) return res.json();

  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;

  return pump();

  function pump() {
    return reader.read().then(({done, value}) => {
      if (done) {
        const text = new TextDecoder().decode(concat(chunks, loaded));
        return JSON.parse(text);
      }
      chunks.push(value);
      loaded += value.length;
      progress.notify(total ?
        {loaded, total, percent: loaded / total, lengthComputable: true} :
        {loaded, lengthComputable: false});
      return pump();
    });
  }
}

function concat(chunks, length) {
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
