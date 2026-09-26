// Keyboard & gamepad bindings — the single source of truth for input.js and for the UI help screen.
//
// Keys are identified by KeyboardEvent.code (physical position: works on AZERTY/QWERTZ too),
// except '?' which is matched by KeyboardEvent.key. Ctrl/Meta/Alt combinations are NEVER used
// (they are browser shortcuts: Ctrl+W closes the tab, Alt+Left navigates back), and F5/F11/F12
// are left to the browser.
//
// BINDINGS (for the help screen): [{ group, keys: string[], action: string, gamepad?: string }]
//   keys    display labels; several labels = alternatives or a +/- pair ("W", "S")
//   action  what it does, phrased for the player
//
// Guidance programs can also be selected with the 'action' event PROGRAM {program}
// (P00, P40, P47, P63, P64, P66, P67, P68, P12, P70, P71) — there is no key for it; the Esc menu's
// Flight tab offers them (Guidance section).

/** Continuous hand-controller axes: code -> [axis, sign]. */
export const AXIS_KEYS = {
  // rotation hand controller (ACA / RHC): W = nose down, S = nose up (like pushing / pulling a stick)
  KeyW: ['pitch', -1],
  KeyS: ['pitch', +1],
  KeyA: ['yaw', -1],
  KeyD: ['yaw', +1],
  KeyQ: ['roll', -1],
  KeyE: ['roll', +1],
  Numpad8: ['pitch', -1],
  Numpad2: ['pitch', +1],
  Numpad4: ['yaw', -1],
  Numpad6: ['yaw', +1],
  Numpad7: ['roll', -1],
  Numpad9: ['roll', +1],
  // translation hand controller (TTCA / THC)
  KeyH: ['transFwd', +1],
  KeyN: ['transFwd', -1],
  KeyJ: ['transRight', -1],
  KeyL: ['transRight', +1],
  KeyI: ['transUp', +1],
  KeyK: ['transUp', -1],
};

/** Throttle lever keys (held = ramp; P66 AUTO: rate-of-descent switch clicks). */
export const THROTTLE_KEYS = { up: 'KeyR', down: 'KeyF', full: 'KeyZ', cut: 'KeyX' };

/** Landing-point designator clicks (P64): code -> {dx, dy}. dy +1 = farther / up, dx +1 = right. */
export const LPD_KEYS = {
  ArrowUp: { dx: 0, dy: 1 },
  ArrowDown: { dx: 0, dy: -1 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
};

/** Autopilot modes on the digit row (Digit1..Digit9, Digit0). */
export const AUTOPILOT_KEYS = {
  Digit1: 'OFF',
  Digit2: 'PROGRADE',
  Digit3: 'RETROGRADE',
  Digit4: 'RADIAL_OUT',
  Digit5: 'RADIAL_IN',
  Digit6: 'NORMAL',
  Digit7: 'ANTINORMAL',
  Digit8: 'LOCAL_VERTICAL',
  Digit9: 'TARGET',
  Digit0: 'GUIDANCE',
};

/**
 * Discrete actions: code -> action name (plain key) — `shift` variants override with Shift held.
 * Handled specially in input.js: Backspace (STAGE needs a double press), KeyX (throttle cut +
 * ENGINE_STOP, which latches; Shift+X = ENGINE_START resets the latch), CapsLock (fine control),
 * Slash with Shift / '?' (HELP).
 */
export const ACTION_KEYS = {
  Space: 'PRO',
  KeyY: 'AUTO_TOGGLE',
  KeyT: 'RCS_MODE_CYCLE',
  KeyB: 'ATT_HOLD_TOGGLE',
  KeyG: 'KILL_ROT',
  KeyV: 'SWITCH_VESSEL',
  KeyU: 'UNDOCK',
  Enter: 'MASTER_ALARM_RESET',
  NumpadEnter: 'MASTER_ALARM_RESET',
  KeyC: 'CYCLE_CAMERA',
  KeyO: 'GLANCE',
  Home: 'RESET_VIEW',
  Comma: 'WARP_DOWN',
  Period: 'WARP_UP',
  Slash: 'WARP_RESET',
  KeyP: 'PAUSE',
  Escape: 'MENU',
  F1: 'HELP',
  Tab: 'TOGGLE_HUD',
  KeyM: 'MUTE',
  F3: 'TOGGLE_UNITS',
};
export const SHIFT_ACTION_KEYS = {
  KeyC: 'CYCLE_STATION',
  KeyX: 'ENGINE_START', // resets the latched ENGINE STOP (X)
};

/** Keys that still work while a UI overlay captures input (so the same key closes it). */
export const PASSTHROUGH_ACTIONS = new Set(['MENU', 'HELP']);

/** Double-press window for STAGE (Backspace) in seconds. */
export const STAGE_CONFIRM_TIME = 1.0;

/**
 * Standard-mapping gamepad layout (https://w3c.github.io/gamepad/#remapping).
 * Buttons: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 Back, 9 Start, 10 L3, 11 R3,
 * 12-15 d-pad up/down/left/right.
 */
export const GAMEPAD = {
  axes: { roll: 0, pitch: 1, yaw: 2, transUp: 3 },
  buttons: {
    A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11,
    UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
  },
  // edge-triggered actions
  actions: { 0: 'PRO', 1: 'KILL_ROT', 2: 'RCS_MODE_CYCLE', 3: 'CYCLE_CAMERA', 8: 'SWITCH_VESSEL', 9: 'PAUSE', 11: 'RESET_VIEW' },
  deadzone: 0.12,
  expoRotation: 0.45,
  expoTranslation: 0.2,
};

/** Help-screen table. */
export const BINDINGS = [
  // ---- attitude
  { group: 'Attitude (rotation hand controller)', keys: ['W', 'S'], action: 'Pitch nose down / nose up', gamepad: 'Left stick up / down' },
  { group: 'Attitude (rotation hand controller)', keys: ['A', 'D'], action: 'Yaw left / right', gamepad: 'Right stick left / right' },
  { group: 'Attitude (rotation hand controller)', keys: ['Q', 'E'], action: 'Roll left / right', gamepad: 'Left stick left / right' },
  { group: 'Attitude (rotation hand controller)', keys: ['Num 8', 'Num 2', 'Num 4', 'Num 6', 'Num 7', 'Num 9'], action: 'Pitch / yaw / roll on the numeric keypad' },
  { group: 'Attitude (rotation hand controller)', keys: ['Caps Lock'], action: 'Fine control (reduced rates and translation)', gamepad: 'Left stick click' },
  { group: 'Attitude (rotation hand controller)', keys: ['T'], action: 'RCS mode: RATE (rate command / attitude hold) → PULSE → DIRECT', gamepad: 'X' },
  { group: 'Attitude (rotation hand controller)', keys: ['B'], action: 'Attitude hold on / off', },
  { group: 'Attitude (rotation hand controller)', keys: ['G'], action: 'Kill rotation', gamepad: 'B' },
  // ---- translation
  { group: 'Translation (thrust/translation controller)', keys: ['H', 'N'], action: 'Forward / back', gamepad: 'D-pad up / down' },
  { group: 'Translation (thrust/translation controller)', keys: ['J', 'L'], action: 'Left / right', gamepad: 'LB / RB, d-pad left / right' },
  { group: 'Translation (thrust/translation controller)', keys: ['I', 'K'], action: 'Up / down', gamepad: 'Right stick up / down' },
  // ---- engine
  { group: 'Engine', keys: ['R', 'F'], action: 'Throttle up / down (hold; Shift = fine)', gamepad: 'RT / LT' },
  { group: 'Engine', keys: ['Z'], action: 'Full throttle' },
  { group: 'Engine', keys: ['X'], action: 'ENGINE STOP — cuts the throttle and latches: the engine stays off, even under guidance, until ENGINE START (X again with the engine off also resets it)' },
  { group: 'Engine', keys: ['Shift+X'], action: 'ENGINE START — reset the ENGINE STOP latch (then throttle up to relight)' },
  { group: 'Engine', keys: ['R', 'F'], action: 'In P66 with auto throttle: rate-of-descent switch, one click = 1 ft/s (F = descend faster)', gamepad: 'RT / LT' },
  { group: 'Engine', keys: ['Backspace ×2'], action: 'ABORT STAGE — separate the ascent stage (press twice within 1 s)' },
  // ---- guidance computer
  { group: 'Guidance computer', keys: ['Space'], action: 'PROCEED (DSKY PRO)', gamepad: 'A' },
  { group: 'Guidance computer', keys: ['Y'], action: 'Auto / manual throttle — P64 → P66 → P67' },
  { group: 'Guidance computer', keys: ['↑', '↓', '←', '→'], action: 'P64: redesignate the landing point (farther / shorter / left / right)', gamepad: 'D-pad in P64' },
  { group: 'Guidance computer', keys: ['1'], action: 'Autopilot off (attitude hold)' },
  { group: 'Guidance computer', keys: ['2', '3'], action: 'Point prograde / retrograde' },
  { group: 'Guidance computer', keys: ['4', '5'], action: 'Point radial out / radial in' },
  { group: 'Guidance computer', keys: ['6', '7'], action: 'Point orbit normal / anti-normal' },
  { group: 'Guidance computer', keys: ['8'], action: 'Hold local vertical' },
  { group: 'Guidance computer', keys: ['9'], action: 'Point at the other spacecraft' },
  { group: 'Guidance computer', keys: ['0'], action: 'Guidance steering (re-engage the program)' },
  { group: 'Guidance computer', keys: ['Enter'], action: 'Master alarm reset' },
  // ---- spacecraft
  { group: 'Spacecraft', keys: ['V'], action: 'Switch between Eagle and Columbia', gamepad: 'Back' },
  { group: 'Spacecraft', keys: ['U'], action: 'Undock' },
  // ---- views
  { group: 'Views', keys: ['C'], action: 'Next camera: cockpit → chase → locked → fly-by → ground → target', gamepad: 'Y' },
  { group: 'Views', keys: ['Shift+C'], action: 'Next crew station (cockpit view)' },
  { group: 'Views', keys: ['O'], action: 'Cockpit glance: window → flight displays → DSKY (Columbia: console → rendezvous window)' },
  { group: 'Views', keys: ['Home'], action: 'Reset the view', gamepad: 'Right stick click' },
  { group: 'Views', keys: ['←', '↑', '→', '↓'], action: 'Look around (outside P64)' },
  { group: 'Views', keys: ['Mouse drag'], action: 'Look around / orbit the camera (double-click resets, middle-click = mouse look)' },
  { group: 'Views', keys: ['Mouse wheel'], action: 'Zoom' },
  // ---- simulation
  { group: 'Simulation', keys: [',', '.'], action: 'Time warp slower / faster' },
  { group: 'Simulation', keys: ['/'], action: 'Time warp off' },
  { group: 'Simulation', keys: ['P'], action: 'Pause', gamepad: 'Start' },
  { group: 'Interface', keys: ['Esc'], action: 'Menu' },
  { group: 'Interface', keys: ['F1', '?'], action: 'Help' },
  { group: 'Interface', keys: ['Tab'], action: 'Show / hide the HUD' },
  { group: 'Interface', keys: ['F3'], action: 'Units: imperial (Apollo) / metric' },
  { group: 'Interface', keys: ['M'], action: 'Sound on / off' },
];

/** Every KeyboardEvent.code the game uses (preventDefault while playing). */
export const GAME_CODES = new Set([
  ...Object.keys(AXIS_KEYS),
  ...Object.values(THROTTLE_KEYS),
  ...Object.keys(LPD_KEYS),
  ...Object.keys(AUTOPILOT_KEYS),
  ...Object.keys(ACTION_KEYS),
  ...Object.keys(SHIFT_ACTION_KEYS),
  'Backspace',
  'CapsLock',
]);
