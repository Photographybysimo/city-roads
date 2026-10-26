# venueMap

A circular, venue-centered road map for prints and apparel. Roads are colored by
road-network distance from the venue in flat bands, the venue is marked, and the
export is a print-ready poster or tee file with typography.

## Quick start

Open the app. The home screen is the venue form: type a venue name (or paste
`lat, lon` from Google Maps), pick a radius, hit **Create venue map**. The panel
on the left handles text, colors, poster and t-shirt exports.

## Console

The same flow is available from the console, and opens the same panel:

```js
let v = await venueMap({
  place: 'Ritz-Carlton Sarasota',      // or lat/lon: { lat: 27.3364, lon: -82.5307 }
  radiusKm: 3,                         // 2–5 km loads in seconds
  title: 'The Ritz-Carlton',           // defaults to the place name
  subtitle: 'Sarasota, Florida',
  event: 'Leadership Summit 2026',
  preset: 'gold',                      // ember | ocean | sunset | mono | gold
  bands: 5,                            // = ink colors for screen print
});

v.setPreset('ocean');                  // live on screen
v.preview({ size: '18x24' });          // opens the poster in a new tab
v.downloadSVG({ size: '18x24' });      // vector, for print shops
v.downloadPNG({ size: '18x24' });      // 300 dpi raster
v.downloadPNG({ layout: 'tee', garment: '#ffffff' }); // transparent 12x16 DTG file
```

Sizes: `8x10`, `11x14`, `12x16`, `16x20`, `18x24`, `24x36`, `tee`.

## Notes

- Colors are auto-adjusted to contrast with the background (or `garment` for tees).
- The SVG uses system fonts (Didot / Helvetica Neue). Outline text in Illustrator
  before sending SVG to a printer, or send the PNG.
- Loaded roads are cached in your browser for 30 days. `clearRoadCache()` resets it.
- Credit "© OpenStreetMap contributors" is printed small at the bottom (ODbL).

## Motion: venue pulse

In the panel, **Motion · venue pulse** animates the roads lighting up outward
from the venue by driving distance, with a slow push-in and an optional title card.

- Formats: 16:9 (LED walls, screens), 1:1 (LinkedIn), 9:16 (Reels, Stories)
- Length: 10, 15 or 30 seconds, 30 fps, H.264 MP4
- **Play preview** loops it in the browser; **Export MP4** renders frame by frame
  (exact timing, no dropped frames). Keep the tab in front while it renders.
- Needs Chrome, Edge or Safari (WebCodecs).
