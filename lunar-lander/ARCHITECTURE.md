# Apollo Lunar Landing — Architecture & Module Contracts

A browser flight simulator of the Apollo 11 Command/Service Module **Columbia** and Lunar Module **Eagle**.
The player can fly **both** spacecraft (switch with `V`), from lunar orbit down to a landing at
Tranquility Base and back up again. Everything is procedural (no downloaded assets, no network):
three.js + WebGL2, bundled with Vite into a single offline HTML file.

**Quality bar.** This is meant to look *stunning* and feel *accurate*:
- Controls behave like the real Apollo digital autopilot (rate-command/attitude-hold, pulse, direct),
  with individually simulated RCS jets, real masses, thrusts, Isp, inertia and lunar gravity.
- The Moon looks photographic: multi-scale craters, low-sun shadows, lunar photometry (no Lambert),
  opposition surge around the spacecraft shadow, pitch-black sky, stars, the Earth, the Sun.
- Cockpit interiors look extremely realistic: grey Apollo panels with white lettering, hundreds of
  toggle switches, circuit-breaker panels, live DSKY/FDAI/tape meters/timers, sunlight streaming through
  the windows with crisp shadows, visible structure, wiring, stowage, bungees, handholds.

---------------------------------------------------------------------------------------------------

## 1. Tech & conventions

- **Language:** modern JavaScript ES modules (no TypeScript). three.js `0.186` (`import * as THREE from 'three'`,
  addons from `'three/addons/...'`). No other runtime dependency. **Do not `npm install` anything.**
- **No assets / no network.** All textures are generated at runtime (canvas 2D, shaders, typed arrays).
- **Units:** SI internally (m, kg, s, N, rad). Displays convert (Apollo used ft, ft/s, nmi).
- **All shared numbers** (Moon, Sun, vehicles, geometry, windows, eye points, RCS jets, gear) live in
  `src/core/constants.js`. Read them from there; never hard-code a conflicting value.
- **Frames** (see `src/core/constants.js` header and `src/core/frames.js`):
  - **MCI**: Moon-centred inertial, +Z north pole, +X lon 0, +Y lon 90°E. The Moon does **not** rotate.
  - **Vessel body frames** (three.js local space of each vessel's group):
    - LM: **+Y up** (thrust axis), **−Z forward** (out of the windows), **+X right**. Origin on the centreline at the footpad-bottom plane.
    - CSM: **−Z forward** (nose/probe), **+Y crew head-up**, **+X right**. Origin at the CM/SM interface.
    - Rotations: pitch about +X (nose up = +ωx), yaw about +Y (nose right = −ωy), roll about +Z (roll right = −ωz).
  - `vessel.quat` maps body → MCI. `vessel.angVel` is in the **body** frame.
- **Sun** is fixed in MCI: `SUN_DIR` in `frames.js` (10.8° above the eastern horizon at the site).
  The LM approaches flying **west**, Sun behind it. Earth is at `+X * 384,400 km`.
- Landing site: `LANDING_SITE` (0.674°N, 23.473°E), unit vector `SITE_DIR`.

## 2. Rendering conventions (read carefully)

- **Floating origin / camera-relative rendering.** The camera is always at render-space (0,0,0).
  `ctx.origin` holds the camera's MCI position (doubles). Every object must be placed with
  `object.position.copy(objMCI).sub(frame.origin)` **every frame**. Render axes = MCI axes (only translated),
  so directions/quaternions/`sunDir` need no conversion. Build large meshes relative to a local centre
  (e.g. terrain chunk vertices relative to the chunk centre) so float32 never sees 1.7e6-m coordinates.
- **Depth:** `logarithmicDepthBuffer: true`, camera near 0.01 m, far 1e9 m. **Every custom `ShaderMaterial`
  must include the log-depth chunks**: vertex `#include <common>`, `#include <logdepthbuf_pars_vertex>` and
  after `gl_Position` `#include <logdepthbuf_vertex>`; fragment `#include <logdepthbuf_pars_fragment>` and in
  `main` `#include <logdepthbuf_fragment>`. (Built-in materials handle it automatically.)
- **Layers** (`LAYERS` in constants): `WORLD 0` terrain/sky/rocks, `VESSEL 1` exterior models,
  `GHOST 2` own exterior model while in IVA (drawn only into the vessel-shadow pass so the LM still casts its
  shadow on the ground while you look out of the window), `CABIN 3` interiors, `FX 4` plumes/particles.
  Main camera sees 0,1,3,4. Model modules implement `setIVA(on)` by moving their meshes VESSEL↔GHOST
  (meshes tagged `userData.ivaVisible = true` — e.g. the CSM docking probe — may stay on VESSEL).
- **Lights:**
  - `ctx.sunLight` — `DirectionalLight` (intensity `SUN.intensity`) with a tight shadow box around the
    active vessel (exterior) or the cabin (IVA). Used by all standard (PBR) materials: spacecraft exteriors,
    cabins, rocks if they use standard materials. Cabins **must** be closed shadow casters with window
    openings so sunlight patches through the windows are correct.
  - `ctx.fillLight` — `HemisphereLight` approximating sunlight bounced off the lunar surface (ground colour
    from below), updated each frame by the renderer.
  - `scene.environment` — set by the sky module (PMREM of black sky + Sun + bright lunar ground) for
    reflections on foil, metal, glass.
  - Terrain uses its **own** shader lighting with `frame.sunDir` and lunar photometry (does not need three lights).
- **Vessel shadow on the terrain:** the renderer renders spacecraft depth from the Sun into
  `ctx.vesselShadow` (layers VESSEL+GHOST). Terrain/rocks shaders add `ctx.vesselShadow.uniforms` to their
  uniforms (same objects — they update automatically) and paste `ctx.vesselShadow.glsl`, then call
  `float s = vesselShadow(worldPosRender);` (1 = lit). Enabled below ~1.5 km altitude.
- **Tone mapping / exposure / bloom:** owned by `render/post.js`. The Sun intensity is `SUN.intensity` (7.0)
  in three.js units; a white Lambertian surface facing the Sun outputs ≈ 7/π before exposure.
- **Performance:** target 60 fps at 1080p on a mid-range discrete GPU with `quality=high`; must stay usable on
  integrated GPUs with `quality=low`. Never block the main thread > ~4 ms per frame for generation work:
  use Web Workers or time-slice. **Workers must be created with Vite's inline-worker import** so the single-file
  build keeps working from `file://`:  `import TerrainWorker from './chunk.worker.js?worker&inline'; const w = new TerrainWorker();`
  (the build uses classic `iife` workers; a worker may `import` other modules — Vite bundles them in).
  Do **not** use `new Worker(new URL(...))` (it emits a separate file) and do not rely on `type: 'module'`.

## 3. Main loop (src/main.js — integrator-owned)

```
input.update(realDt)            -> writes game.active.ctrl, emits 'action' events
sim.step(realDt) -> simDt       -> substeps: gnc.update(h); physics(h); telemetry; events
cameras.update(realDt)          -> writes game.view (cameraMCI, quat, fov, near, far, mode, ivaVessel)
frame = renderer.beginFrame()   -> floating origin, sunLight/fillLight, vessel-shadow matrix
models.setIVA / cabins.setActive
terrain.update(frame); sky.update(frame); lmModel.update(frame, LM); csmModel.update(frame, CSM);
lmCabin.update(frame, LM); csmCabin.update(frame, CSM); fx.update(frame)
renderer.renderVesselShadow(); post.render(frame)
ui.update(frame); audio.update(frame)
```

`frame` (FrameContext): `{ dt, simDt, time (MET s), origin, cameraMCI, cameraQuat, sunDir, viewMode,
ivaVessel, active, vessels: {LM, CSM}, game, ctx }`.

`ctx` (RenderContext): `{ THREE, renderer, scene, camera, sunLight, fillLight, origin, game, LAYERS, quality,
qualitySettings, sunDir, vesselShadow, frame, toRender(mci,out), project(mci,out) }`.

URL parameters (`src/core/state.js readParams`): `scenario`, `camera`, `vessel`, `fixedstep=1` (sim advances
exactly 1/60 s per frame — use in headless tests), `quality`, `warp`, `hud=0`, `audio=0`, `t=<seconds>`
(fast-forward after load), `debug=1`. Without `scenario` the title menu is shown.

Test hooks: `window.game` (state) and `window.game.debug` (`setCamera(mode)`, `setVessel(id)`,
`startScenario(id)`, `advance(seconds)`, `modules`, `ctx`, `sim`, `gnc`, `cameras`). `window.__READY` is set
once the first frames have rendered and `terrain.isReady()` returns true.

## 4. Game state (src/core/state.js — the data contract)

`game`: `{ params, events, time{met, warp, warpActual, paused, frame, realDt, simDt}, vessels{LM, CSM},
activeId, active, inactive, scenarioId, started, view{...}, settings{hud, units, audio, volume, callouts,
quality, invertPitch, mouseSensitivity, historicalAlarms}, result, debug }`.

Each vessel (see `createLM()` / `createCSM()`): `pos, vel, quat, angVel, mass, cg, inertia, mainEngine{name,
maxThrust, isp, minThrottle, maxThrottle, thrustDir, nozzleExit, nozzleExitRadius, nozzleThroat, throttle,
throttleCmd, armed, firing, gimbal}, propellant{main, mainMax, rcs, rcsMax, (LM: ascent, ascentMax)},
rcs{jets:[{id, quad, pos, exhaustDir, forceDir, thrust, cmd, level}]}, landed, crashed, crashReason, docked,
dockedTo, ctrl{pitch,yaw,roll,transFwd,transRight,transUp,throttle,fine}, gnc{rcsMode, attHold, autopilot,
throttleMode, program, attError, rodCmd, targetDir, lpdAngle, lpdTimeLeft}, agc{prog, verb, noun, r1, r2, r3,
flashVerbNoun, lights{...}, alarmCode}, cw{masterAlarm, lights{}}, tel{...}`; LM also `staged, descentStage,
gear{pads:[{id,pos,hasProbe,compression,contact,load}], probeContact}`.

Modules may **add** fields; never rename or repurpose existing ones.

## 5. Events (`game.events`, see src/core/events.js)

`'action' {name, ...}` — discrete commands. Handled by:

| Action | Handler | Meaning |
|---|---|---|
| `PAUSE`, `WARP_UP`, `WARP_DOWN`, `WARP_RESET` | sim | pause / time warp (1,2,5,10,50,100,1000; sim limits warp under thrust or near the ground) |
| `SWITCH_VESSEL` `{to?}` | sim | change `game.activeId` (emit `'vessel'`) |
| `UNDOCK`, `DOCK` | sim | separate / (docking is automatic on contact within tolerances) |
| `STAGE` | sim | LM ascent-stage separation (ABORT STAGE) — descent stage stays behind |
| `RESTART` | sim | reload current scenario |
| `RCS_MODE_CYCLE`, `ATT_HOLD_TOGGLE`, `KILL_ROT`, `AUTOPILOT {mode}` | gnc | DAP modes / attitude autopilot |
| `PRO`, `AUTO_TOGGLE`, `PROGRAM {program}` | gnc | DSKY PROCEED; engage/disengage guidance (auto throttle+attitude); select program |
| `ROD_UP`, `ROD_DOWN` | gnc | P66 rate-of-descent switch clicks (±1 ft/s) |
| `LPD {dx, dy}` | gnc | P64 landing-point redesignation clicks |
| `MASTER_ALARM_RESET` | gnc | clear master alarm |
| `CYCLE_CAMERA`, `SET_CAMERA {mode}`, `CYCLE_STATION`, `RESET_VIEW` | cameras | views |
| `TOGGLE_HUD`, `HELP`, `MENU`, `TOGGLE_UNITS` | ui | interface |
| `MUTE` | audio | sound |

Other events: `'message' {text, level}`, `'callout' {text, voice}`, `'scenario' {id}`, `'vessel' {id}`,
`'camera' {mode}`, `'contact'`, `'touchdown' {...}`, `'crash' {...}`, `'engine' {vessel, engine, on}`, `'stage'`,
`'dock'`, `'undock'`, `'alarm' {code, text}`, `'program' {vessel, program}`.

## 6. Module ownership & contracts

Each module is owned by exactly one agent. **Only edit files you own.** If you need something from another
module, code against its contract (stubs exist and run) and list the request in your final report.

| Owner | Files | Factory contract |
|---|---|---|
| integrator | `index.html`, `src/main.js`, `src/core/*`, `src/render/renderer.js`, `vite.config.js`, `tools/*`, `ARCHITECTURE.md` | — |
| SIM-CORE | `src/sim/**`, `test/sim*.test.js` | `createSim(game, {gnc})` → `{ scenarios, loadScenario(id), step(realDt, {ignoreWarp}) → simDt }` |
| GNC | `src/gnc/**`, `test/gnc*.test.js` | `createGNC(game)` → `{ reset(), update(h) }` (per physics substep, all vessels) |
| TERRAIN | `src/world/**`, `src/render/terrain/**`, `test/moon*.test.js` | `world/moon.js`: pure `terrainHeight(x,y,z)`, `surfaceRadius`, `surfaceNormal(x,y,z,out)`, `albedo`; `createTerrain(ctx)` → `{ update(frame), isReady() }` |
| SKY-FX | `src/render/sky/**`, `src/render/fx/**`, `src/render/post.js` | `createSky(ctx)`, `createEffects(ctx)` → `{ update(frame) }`; `createPost(ctx)` → `{ render(frame), setSize(w,h) }` |
| LM-MODEL | `src/render/models/lm/**` | `createLMModel(ctx)` → `{ root, update(frame, vessel), setIVA(on) }` |
| CSM-MODEL | `src/render/models/csm/**` | `createCSMModel(ctx)` → `{ root, update(frame, vessel), setIVA(on) }` |
| INSTRUMENTS | `src/render/cockpit/kit/**`, `src/render/cockpit/instruments/**` | see §7 |
| LM-CABIN | `src/render/cockpit/lmCabin.js`, `src/render/cockpit/lm/**` | `createLMCabin(ctx)` → `{ root, update(frame, vessel), setActive(on) }` |
| CSM-CABIN | `src/render/cockpit/csmCabin.js`, `src/render/cockpit/csm/**` | `createCSMCabin(ctx)` → `{ root, update(frame, vessel), setActive(on) }` |
| IO | `src/input/**`, `src/render/cameras.js`, `src/render/camera/**`, `src/audio/**` | `createInput(game, el)` → `{ update(dt) }`; `createCameras(game, ctx)` → `{ update(dt), setMode(m), cycle(), modes }`; `createAudio(game)` → `{ update(frame), resume() }` |
| UI | `src/ui/**` | `createUI(game, rootEl, api)` → `{ update(frame) }`; `api = { scenarios, startScenario(id), ctx, cameras, sim }` |

Model/cabin modules position their own `root` each frame (`root.position = vessel.pos − origin`,
`root.quaternion = vessel.quat`). After LM staging the LM model must also draw the descent stage left behind at
`vessel.descentStage.{pos,quat}`.

### Terrain (`src/world/moon.js`)
Pure deterministic functions of a **unit direction** `(x,y,z)` (MCI). Height is metres above `MOON.radius` and
must include everything physics should collide with (craters, and boulders if they are collidable). Must run
identically in the main thread and in workers (no DOM/three scene). Must be fast: physics calls it ~10×
per 20-ms substep; renderer workers call it millions of times.

### Cameras (`game.view`)
Modes: `iva` (cockpit of the active vessel; stations LM `CDR`/`LMP`/`OVERHEAD`, CSM `CDR`/`CMP`/`LMP`/`RV`),
`chase` (orbits the vessel, horizon-locked), `locked` (fixed in the vessel body frame), `flyby`, `ground`
(on the surface near the site), `target` (looks from the active vessel at the other one). The IVA camera sits
at the station eye point from constants with free head-look (mouse), and FOV zoom.

## 7. Cockpit kit & instruments (INSTRUMENTS agent; used by both cabins)

All factories: face in local XY plane facing **+Z**, centred at the origin, depth toward −Z, metres. Put meshes on
`LAYERS.CABIN` (`setLayerRecursive`). Instruments return `{ object, width, height, update(vessel, game, dt) }`.

Kit (`src/render/cockpit/kit/index.js`): `COLORS`, `setLayerRecursive(obj, layer)`,
`createCanvasTexture(wM, hM, pxPerM)`, `createPanel(spec)`, `createToggleSwitch(opts)` (`.setState`),
`createCircuitBreakerPanel(opts)`, `createRotarySwitch(opts)`, `createPushButton(opts)` (`.setLit`),
`createPlacard(opts)`.

Instruments (`src/render/cockpit/instruments/index.js`): `createDSKY`, `createFDAI({size})`, `createAltTapes`,
`createRangeTapes`, `createCrossPointer({size})`, `createMissionTimer`, `createEventTimer`,
`createAnnunciatorPanel({labels, cols, cellW, cellH})`, `createMasterAlarm`, `createGauge(opts)`,
`createThrustIndicator`, `createContactLights`, `createEMS`, `createGPI`, `createPropellantGauges`.
Signatures, options and sizes are documented (JSDoc) in those files; they are the contract.

**Mounting rule.** Instruments are real 3D objects that extend *behind* their face plane by `inst.depth`
(FDAI 0.16 m, tapes 0.053 m, EMS 0.048 m, most gauges/timers 0.033 m, DSKY 0.014 m). Mount each in a panel
cut-out: `createPanel({ holes: [{ x, y, w: inst.mountHole.w, h: inst.mountHole.h }] })`, then place
`inst.object` at `(x, y, 0)` on that panel; keep solid structure at least `inst.depth` behind it.
Call `inst.update(vessel, game, dt)` every frame while the cabin is active (it rate-limits itself).

**Extra kit factories:** `createSwitchBank` (alias `createToggleSwitchArray`), `createBreakerBank`,
`createThumbwheel`, `createTalkback`, `createLamp`, `createChecklistCard`, `createLabelStrip`,
`createPainter`, `createCabinEnvironment(renderer, {windows, up})` + `setCabinEnvironment(env)` (interior
reflections instead of the outdoor lunar environment), `setIntegralLighting(0..1)`, `setLampBrightness(k)`.
Extra instrument: `createDigitalReadout`. The DSKY exposes `pressKey(name)` and reacts to `PRO`,
`MASTER_ALARM_RESET` and `PROGRAM` actions; `createDSKY({ variant: 'CM' })` for the Command Module.

## 7b. Post-processing outputs

`post.js` writes `ctx.exposureInfo = { ev, multiplier, sunVisible, valid }` (refreshed asynchronously every few
frames). Self-luminous things (lamps, plumes, displays) may scale by `multiplier ** -0.5` to stay plausible
under auto-exposure. Settings read by post: `game.settings.filmGrain`, `game.settings.exposureComp` (EV).

## 8. Testing

- `node tools/shot.mjs --query "scenario=hover&camera=chase&fixedstep=1" --out shots/<you>/x.png [--wait ms]
  [--eval "js"] [--json "js"] [--size 1600x900]` — starts a private Vite server, renders in headless Chromium
  (SwiftShader: slow but faithful), saves a PNG you can open with the Read tool, prints console errors, exits 1 on
  uncaught page errors. Write your screenshots under `shots/<your-agent-name>/`.
- You may add harness pages under `dev/<your-agent-name>*.html` (served by the same Vite server:
  `--page dev/<name>.html`).
- Pure logic (physics, guidance, terrain functions): `node --test test/` with `node:test` + `node:assert`.
- `npx vite build` must succeed (integrator runs it; don't run it concurrently yourself — use `--outDir dist-<you>` if you must).
