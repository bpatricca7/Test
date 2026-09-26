# Apollo 11 — Tranquility Base

A browser flight simulator of the Apollo 11 **Command/Service Module _Columbia_** and **Lunar Module _Eagle_**.
Fly both spacecraft — undock in lunar orbit, ride the powered descent, take over from the computer in P66
and set Eagle down on the Moon, then lift off and rendezvous with Columbia.

Everything is procedural and runs offline: no downloaded models, textures or sounds.

## Play

```bash
npm install
npm run dev            # http://127.0.0.1:5173
npm run build          # dist/index.html — one self-contained file, works from file://
```

Open `dist/index.html` directly in a desktop browser (Chrome, Edge, Firefox, Safari) with WebGL 2.
A keyboard or a gamepad is required to fly. Quality can be changed in **Settings** (low / medium / high).

## Missions

| Mission | Start | What you do |
|---|---|---|
| Powered Descent | 15 km, 40 s before PDI | Press PRO at the flashing V99, ride P63 → P64, take over in P66 and land |
| Approach Phase | High Gate, 2.3 km (P64) | Watch the site through the LPD reticle, redesignate, land |
| Final Descent | Low Gate, 150 m (P66) | The computer flies it; take the attitude or the descent rate whenever you like |
| Landing Practice | Hover at 60 m | Fully manual: throttle, attitude, translation |
| Lunar Orbit | Docked, 111 km | Undock, fly both spacecraft, P40 DOI → descent → landing |
| Lunar Liftoff | On the surface | P12 powered ascent to orbit |
| Columbia Solo | CSM in orbit | Fly Columbia while Eagle lands (switch any time) |
| Docking | 15 m from Eagle | Line up the COAS and dock by hand |

## Controls (keyboard)

| Keys | Action |
|---|---|
| W / S, A / D, Q / E | Pitch, yaw, roll (rotation hand controller) — Caps Lock = fine |
| H / N, J / L, I / K | Translate forward/back, left/right, up/down |
| R / F (hold) | Throttle up / down — in P66 AUTO: rate-of-descent clicks (1 ft/s) |
| Z / X | Full throttle / **ENGINE STOP** (latches) — Shift+X re-enables the engine |
| Space | DSKY **PRO** (proceed) |
| Y | Auto / manual guidance (P64 → P66 → P67) |
| Arrow keys | P64: redesignate the landing point · otherwise look around |
| T / B / G | RCS mode (RATE → PULSE → DIRECT) / attitude hold / kill rotation |
| 1 – 9, 0 | Autopilot: off, prograde, retrograde, radial out/in, normal/anti-normal, local vertical, target, guidance |
| Backspace ×2 | ABORT STAGE |
| V / U | Switch spacecraft / undock |
| C / Shift+C / O | Camera / crew station / glance at the instruments |
| Mouse drag, wheel | Look around or orbit the camera, zoom |
| , . / | Time warp slower / faster / off |
| P · Esc · F1 · Tab · M · F3 | Pause · menu · help · HUD · sound · units |

Gamepads with the standard mapping work too (left stick pitch/roll, right stick yaw + up/down, triggers throttle,
A = PRO). The in-game **Controls** page is the full reference.

## How realistic is it?

- **Flight dynamics:** 6-DOF rigid bodies with real Apollo 11 masses, inertias, engine thrust/Isp and propellant;
  each of the 32 RCS jets is simulated individually with its real position and direction; lunar point-mass gravity;
  crushable-strut landing gear with 1.73 m contact probes; probe-and-drogue docking; staging.
- **Guidance & control:** Apollo-style digital autopilots (rate command/attitude hold, pulse, direct), the LGC
  descent programs P63/P64/P66 with landing-radar lock and LPD redesignation, P12 ascent, P40 DOI, P70/P71 aborts,
  and a DSKY showing the real verbs/nouns (N63, N64, N60, …) with Aldrin-style callouts.
- **The Moon:** procedural near side with the real maria and 56 named craters at their true positions, craters
  down to metre scale, collidable boulders, the 10.8° Apollo 11 Sun, lunar photometry and the 1969 sky
  (real bright stars, the Earth where it hung over Tranquility Base).
- **Cockpits:** the LM and CM cabins with their panels, hundreds of switches and circuit breakers, and live
  instruments (DSKY, FDAI, tapes, cross-pointer, timers, caution & warning lights).
- **Simplifications:** the Moon does not rotate; terrain is procedural (not LOLA data); some panel layouts are
  reconstructions.

## Development

- `ARCHITECTURE.md` — module contracts, frames, rendering conventions (floating origin, reversed-Z / log depth).
- `npm test` — node tests for physics, guidance, terrain, instruments, cameras and input.
- `node tools/shot.mjs --query "scenario=hover&camera=chase&fixedstep=1" --out shots/x.png` — headless screenshot.
- `node tools/qa.mjs` — screenshot matrix of every mission and camera.
- URL parameters: `scenario`, `camera`, `vessel`, `quality`, `hud=0`, `fixedstep=1`, `depth=log`.
