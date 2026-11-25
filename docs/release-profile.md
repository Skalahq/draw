# Release profile

Measured on 2026-11-25 with Playwright 1.65.1 Chromium against the production demo at `/profile`.

Workload: 1,000 notes in a 40 by 25 grid, each 32 by 20, plus 975 connections between neighbors in each row. The page samples `requestAnimationFrame` gaps and shows the maximum.

Gestures: select and drag a node, pan with the keyboard, zoom in, cancel a freehand stroke, then commit one.

| Browser | Nodes | Connections | Max frame gap |
| --- | ---: | ---: | ---: |
| Playwright 1.65.1 Chromium | 1000 | 975 | 17 ms isolated, 33 ms in `bun run check` |

The release check fails if that gap reaches 1,000 ms. Neither measurement is release-blocking. Pan and zoom stay on the CSS viewport transform. No custom GPU path is needed.
