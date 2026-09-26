// Reusable cockpit construction kit (INSTRUMENTS agent) — used by the LM and CSM cabins.
//
// Contract (ARCHITECTURE.md §7): every factory builds its object in a local frame whose FACE lies in
// the XY plane facing +Z, centred on the origin, depth toward -Z (hardware such as toggles and knobs
// stands proud toward +Z). Units: metres. Everything returned here is already on LAYERS.CABIN
// (cabins may call setLayerRecursive again after adding their own children).
//
// Quick reference
//   COLORS, LAMP_COLORS, LIGHTING               palette & global lighting state
//   setLayerRecursive(obj, layer=CABIN)
//   createCanvasTexture(wM, hM, pxPerM)         -> {canvas, g, texture, pxPerM}
//   createPainter(wM, hM, {color, pxPerM})      metre-space painter (text, box, line, screw, wear...)
//   drawText(g, text, x, y, sizePx, opts)       Apollo condensed caps text on any 2D canvas
//   createPanel(spec)                           grey panel + lettering + holes + hardware (see panel.js)
//   createToggleSwitch(opts)        .setState   single bat-handle toggle
//   createSwitchBank({switches, panel})         instanced toggles (hundreds), legends on the panel
//   createToggleSwitchArray                     alias of createSwitchBank
//   createCircuitBreakerPanel(opts) .setPopped  grid of CBs with row strips / group strips / legends
//   createBreakerBank({breakers})               instanced CB hardware only
//   createRotarySwitch(opts)        .setIndex   pointer knob + position legends
//   createThumbwheel(opts)          .setValue
//   createTalkback(opts)            .setState   'grey' | 'barber' | 'line-h' | 'line-v' | 'blank'
//   createPushButton(opts)          .setLit     lit legend push button
//   createLamp(opts)                .setLit     small round jewel lamp
//   createPlacard(opts), createChecklistCard(opts), createLabelStrip(opts), createDecal(w,h,draw)
//   createGlass(w, h, z, round)                 reflective cover glass
//   getMaterial(name), createMaterial(name, overrides), createPaintedMaterial(painter)
//   setLampBrightness(k), setIntegralLighting(level, color)
//   setLampExposure(ctx.exposureInfo)            auto-exposure compensation of lamps/displays (per frame)
//   useInstancedShadowDepth(instancedMesh)      own shadow depth material (keeps the shadow pass cheap)
//   setCabinEnvironment(createCabinEnvironment(ctx.renderer, {windows})) — RECOMMENDED for every cabin:
//     interior reflections for chrome/glass instead of the outdoor env (which shows the Sun through walls)
import { LAYERS } from '../../../core/constants.js';
import * as panel from './panel.js';
import * as sw from './switches.js';
import * as cb from './breakers.js';
import * as ctl from './controls.js';
import * as plc from './placards.js';

export { COLORS, LAMP_COLORS, LIGHTING, LAMP_INTENSITY, getMaterial, createMaterial, createPaintedMaterial, MATERIAL_NAMES, registerLamp, setLampLevel, setLampBrightness, setIntegralLighting, registerIntegral, setCabinEnvironment, createCabinEnvironment, glassSmudgeTexture, useInstancedShadowDepth, setLampExposure, LAMP_EXPOSURE_REF } from './materials.js';
export { createCanvasTexture, createPainter, drawText, measureText, FONT_STACK, MONO_STACK, MAX_TEX, rng, hashString, css, roundRectPath } from './canvas.js';
export { TOGGLE_THROW, printToggleLegends, mergeSimple } from './switches.js';
export { CB_POP, layoutBreakers } from './breakers.js';
export { planarUV, roundedRectShape, roundedSlab, frameSlab, createDecal, decalPainter, talkbackTexture, createGlass, createLampFace } from './controls.js';

/**
 * Put `obj` and all its descendants on a render layer (default LAYERS.CABIN).
 * @param {THREE.Object3D} obj
 * @param {number} [layer]
 * @returns {THREE.Object3D} obj
 */
export function setLayerRecursive(obj, layer = LAYERS.CABIN) {
  obj.traverse((o) => o.layers.set(layer));
  return obj;
}

const onCabin = (f) =>
  function (...args) {
    const r = f(...args);
    const o = r?.isObject3D ? r : r?.object;
    if (o?.isObject3D) setLayerRecursive(o, LAYERS.CABIN);
    return r;
  };

/** @see panel.createPanel */
export const createPanel = onCabin(panel.createPanel);
/** @see panel.createCircuitBreakerPanel */
export const createCircuitBreakerPanel = onCabin(panel.createCircuitBreakerPanel);
/** @see switches.createToggleSwitch */
export const createToggleSwitch = onCabin(sw.createToggleSwitch);
/** @see switches.createSwitchBank — returns {object, switches, byId, setState, getState} */
export const createSwitchBank = onCabin(sw.createSwitchBank);
/** Alias of createSwitchBank. */
export const createToggleSwitchArray = createSwitchBank;
/** @see breakers.createBreakerBank */
export const createBreakerBank = onCabin(cb.createBreakerBank);
/** @see controls.createRotarySwitch */
export const createRotarySwitch = onCabin(ctl.createRotarySwitch);
/** @see controls.createThumbwheel */
export const createThumbwheel = onCabin(ctl.createThumbwheel);
/** @see controls.createTalkback */
export const createTalkback = onCabin(ctl.createTalkback);
/** @see controls.createPushButton */
export const createPushButton = onCabin(ctl.createPushButton);
/** @see controls.createLamp */
export const createLamp = onCabin(ctl.createLamp);
/** @see placards.createPlacard */
export const createPlacard = onCabin(plc.createPlacard);
/** @see placards.createChecklistCard */
export const createChecklistCard = onCabin(plc.createChecklistCard);
/** @see placards.createLabelStrip */
export const createLabelStrip = onCabin(plc.createLabelStrip);
