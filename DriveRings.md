# driveRings

Colors every road by its road-network distance from one point. The result is concentric
color bands that follow the real street grid outward from a venue, home or landmark.

Each band is one flat color, so the SVG export contains exactly `bands` stroke colors,
one per ink for screen printing.

## Usage

Load a city, open the developer console, then:

```js
let rings = driveRings({
  from: { lat: 27.3364, lon: -82.5307 }, // default: map center
  bands: 6,          // 2–12 color bands (= ink colors)
  preset: 'ember',   // ember | ocean | sunset | mono | gold
  // palette: ['#fff3b0', '#7a1f3d'],  // or your own colors, center → edge
  // maxDistance: 8000,                 // meters; default = 98th percentile
  // keepScene: true,                   // keep the original city underneath
});

rings.setPreset('ocean');   // swap palette, no recompute
rings.setBands(4);          // fewer inks
rings.setLineWidth(2);
rings.dispose();            // remove and restore the original city
```

Roads not connected to the start point are left out.

## Print tips

- Set a dark background (`scene.background = '#0b0b0b'`) for `ember`, `gold`, `ocean`.
- Export as SVG for print. It's vector, so it scales to any poster size.
- Credit "© OpenStreetMap contributors" on the product or listing (ODbL requirement).
