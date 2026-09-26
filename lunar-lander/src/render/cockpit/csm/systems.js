// Display-side model of the Command Module's electrical, environmental and propulsion telemetry
// (CSM-CABIN agent). The simulation models the flight dynamics only; the cabin still needs
// plausible, *live* values for its ~60 meters: fuel-cell flows and temperatures that follow the
// electrical load, bus volts/amps that sag when the SPS gimbals or the RCS heaters draw power,
// cryogenic tank pressures cycling with the heaters/fans, cabin & suit loop values, SPS and SM RCS
// pressures and quantities from the vessel's propellant state.
//
// Pure: depends only on the vessel state and MET (deterministic, unit-testable). Nominal numbers
// from the Apollo 11 CSM-107 lunar-orbit telemetry / Apollo Operations Handbook.
//
// state = createSystems(); updateSystems(state, vessel, met, dt) -> state (fields below)

/** Smooth deterministic wobble (sum of sines) in [-1, 1]. */
function wob(t, a, b = 0) {
  return 0.6 * Math.sin(t * a + b) + 0.4 * Math.sin(t * a * 2.37 + b * 1.7);
}

const approach = (cur, target, dt, tau) => cur + (target - cur) * Math.min(1, dt / tau);

/**
 * @returns {object} systems state with the nominal lunar-orbit values
 */
export function createSystems() {
  return {
    // EPS
    fc: [0, 1, 2].map((i) => ({ amps: 22, h2Flow: 0.05, o2Flow: 0.4, skinTemp: 405, condTemp: 162, id: i + 1 })),
    busA: 28.8, busB: 28.9, // main bus volts
    dcAmps: 66, // total fuel-cell current
    acVolts: 116, acFreq: 400,
    batVolts: 37.0, batRelay: 36.8,
    // cryogenics (psia, % quantity)
    h2Press: [236, 238], o2Press: [905, 902], h2Qty: [52, 53], o2Qty: [61, 62],
    // ECS
    cabinPress: 5.0, suitPress: 4.85, cabinTemp: 71, suitTemp: 55, o2Flow: 0.25, co2: 1.2, glycolTemp: 45,
    // propulsion
    spsFuelPress: 178, spsOxPress: 176, spsHe: 3600, spsFuelQty: 60, spsOxQty: 60.6, unbalance: 30,
    rcsHePress: [2950, 2980, 2940, 2960], rcsHeTemp: [68, 70, 67, 69], rcsQty: [76, 76, 75, 76],
    rcsMfldPress: [181, 180, 182, 181],
    // S-band / HGA
    sbandSignal: 0.7,
    // derived "load" used by several meters
    load: 0,
  };
}

/**
 * Advance the display model.
 * @param {object} s state from createSystems()
 * @param {object} v CSM vessel (propellant, mainEngine, rcs.jets, docked)
 * @param {number} met mission elapsed time (s)
 * @param {number} dt real time step (s)
 * @returns {object} s
 */
export function updateSystems(s, v, met, dt) {
  dt = Math.min(0.5, Math.max(0, dt || 0));
  const t = met;
  // electrical load: base ~66 A (lunar orbit), SPS gimbal motors & valves, RCS jets and heaters
  let jets = 0;
  for (const j of v?.rcs?.jets || []) jets += j.level || 0;
  const sps = v?.mainEngine?.firing ? 1 : 0;
  const load = 66 + 14 * sps + 1.2 * jets + 3 * (wob(t, 0.013) + 1);
  s.load = approach(s.load || load, load, dt, 0.4);
  s.dcAmps = s.load;
  for (const fc of s.fc) {
    const share = s.load / 3 + 1.5 * wob(t, 0.05, fc.id);
    fc.amps = share;
    // H2 flow 0.0026 lb/h per A (Faraday), O2 = 8x mass
    fc.h2Flow = approach(fc.h2Flow, 0.0026 * share, dt, 2);
    fc.o2Flow = approach(fc.o2Flow, 0.0206 * share, dt, 2);
    fc.skinTemp = approach(fc.skinTemp, 400 + 0.5 * share + 4 * wob(t, 0.004, fc.id), dt, 20);
    fc.condTemp = approach(fc.condTemp, 160 + 0.15 * share + 2 * wob(t, 0.006, fc.id * 2), dt, 20);
  }
  // bus voltage sags with load (fuel-cell polarisation curve ~ -0.035 V/A about 28.8 V at 66 A)
  s.busA = 28.8 - 0.035 * (s.load - 66) + 0.05 * wob(t, 0.9);
  s.busB = s.busA + 0.08 + 0.04 * wob(t, 1.1, 2);
  s.acVolts = 116 + 0.8 * wob(t, 0.3) - 0.05 * (s.load - 66);
  s.acFreq = 400 + 0.3 * wob(t, 0.7);
  // cryogenics: pressures cycle with the automatic heaters (sawtooth), quantities fall with use
  const hours = met / 3600;
  for (let i = 0; i < 2; i++) {
    const phH = ((t / 2400 + i * 0.37) % 1);
    const phO = ((t / 1800 + i * 0.53) % 1);
    s.h2Press[i] = 225 + 20 * (phH < 0.15 ? phH / 0.15 : 1 - (phH - 0.15) / 0.85);
    s.o2Press[i] = 865 + 70 * (phO < 0.12 ? phO / 0.12 : 1 - (phO - 0.12) / 0.88);
    s.h2Qty[i] = Math.max(5, 98 - hours * 0.44 - i * 0.8);
    s.o2Qty[i] = Math.max(5, 99 - hours * 0.36 - i * 0.6);
  }
  // ECS (5 psia pure O2 cabin, suit loop slightly lower)
  s.cabinPress = 5.0 + 0.03 * wob(t, 0.02);
  s.suitPress = 4.86 + 0.03 * wob(t, 0.03, 1);
  s.cabinTemp = 71 + 1.5 * wob(t, 0.001);
  s.suitTemp = 55 + 1 * wob(t, 0.002, 1);
  s.o2Flow = 0.25 + 0.06 * wob(t, 0.05);
  s.co2 = 1.2 + 0.4 * wob(t, 0.0007);
  s.glycolTemp = 45 + 1.5 * wob(t, 0.002, 2);
  // SPS: propellant quantity from the vessel; tanks pressurised ~175 psia (regulated when firing)
  const main = v?.propellant?.main ?? 0;
  const mainMax = v?.propellant?.mainMax || 1;
  // the displayed % is of the full loaded SPS tanks (18,410 kg) — lunar-orbit remainder ~ 38 %
  const fullLoad = 18410;
  const qty = Math.max(0, Math.min(99.9, (main / fullLoad) * 100 * (mainMax > 0 ? 1 : 0)));
  s.spsOxQty = qty + 0.35 + 0.1 * wob(t, 0.01);
  s.spsFuelQty = qty;
  s.unbalance = 30 + 20 * wob(t, 0.004) + (sps ? 40 * wob(t, 0.3) : 0);
  const pTarget = sps ? 172 + 2 * wob(t, 5) : 178;
  s.spsFuelPress = approach(s.spsFuelPress, pTarget, dt, 0.3);
  s.spsOxPress = approach(s.spsOxPress, pTarget - 2, dt, 0.3);
  s.spsHe = 3600 - (1 - main / mainMax) * 900;
  // SM RCS: quantity from the vessel's RCS propellant, helium pressure falls with use
  const rcs = v?.propellant?.rcs ?? 0;
  const rcsMax = v?.propellant?.rcsMax || 1;
  const rq = (rcs / rcsMax) * 100;
  const quadJets = [0, 0, 0, 0];
  for (const j of v?.rcs?.jets || []) {
    const k = 'ABCD'.indexOf(j.quad);
    if (k >= 0) quadJets[k] += j.level || 0;
  }
  for (let i = 0; i < 4; i++) {
    s.rcsQty[i] = Math.max(0, rq - i * 0.6 + 0.3 * wob(t, 0.02, i));
    s.rcsHePress[i] = 900 + 22 * s.rcsQty[i] + 10 * wob(t, 0.01, i);
    s.rcsHeTemp[i] = 68 + 2 * wob(t, 0.001, i);
    s.rcsMfldPress[i] = approach(s.rcsMfldPress[i], 181 - 6 * Math.min(1, quadJets[i]), dt, 0.15);
  }
  // S-band signal strength: steady with slow scintillation (Earth in view assumed)
  s.sbandSignal = 0.72 + 0.04 * wob(t, 0.5);
  return s;
}
