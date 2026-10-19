/**
 * Rendering-independent clock. A complete day takes 20 real minutes by default.
 * Time 0 is 06:00; the 10 min / 50 s / 8 min 20 s / 50 s phase proportions
 * stay unchanged when the total duration is adjusted.
 */
export const DAY_CYCLE_LIMITS = Object.freeze({ min: 60, max: 3600, default: 1200 });

const DUSK_START = 12 / 24;
const NIGHT_START = 13 / 24;
const DAWN_START = 23 / 24;
const COLOR_FIELDS = ['sunColor', 'hemiSky', 'hemiGround', 'fogColor', 'fillColor'];
const NUMBER_FIELDS = ['daylight', 'duskStrength', 'sunIntensity', 'hemiIntensity', 'fillIntensity', 'fogNear', 'fogFar', 'exposure'];

// The midday values preserve the existing scene. Blue ambient light keeps the
// night walk readable while warm windows and street lamps become the accents.
const MORNING = {
  daylight: .68, duskStrength: .62, sunColor: 0xffd4a1,
  hemiSky: 0xd3ced0, hemiGround: 0x5a5b48, fogColor: 0xd4c8bf, fillColor: 0xb6c9de,
  sunIntensity: 1.6, hemiIntensity: 1.05, fillIntensity: .32,
  fogNear: 42, fogFar: 140, exposure: 1,
};
const DAY = {
  daylight: 1, duskStrength: 0, sunColor: 0xfff1da,
  hemiSky: 0xd9e8f1, hemiGround: 0x566b50, fogColor: 0xc9dee4, fillColor: 0xd8e7f1,
  sunIntensity: 2.8, hemiIntensity: 1.25, fillIntensity: .35,
  fogNear: 55, fogFar: 155, exposure: 1,
};
const AFTERNOON = {
  daylight: .94, duskStrength: .16, sunColor: 0xffe3ba,
  hemiSky: 0xdce0de, hemiGround: 0x5c664b, fogColor: 0xd0d9d8, fillColor: 0xc5d8ea,
  sunIntensity: 2.6, hemiIntensity: 1.19, fillIntensity: .34,
  fogNear: 52, fogFar: 150, exposure: 1,
};
const SUNSET = {
  daylight: .38, duskStrength: 1, sunColor: 0xffb77e,
  hemiSky: 0xb5adbc, hemiGround: 0x4f4e47, fogColor: 0xc5b0ac, fillColor: 0xa4b5dd,
  sunIntensity: 1.05, hemiIntensity: .84, fillIntensity: .3,
  fogNear: 50, fogFar: 165, exposure: 1.02,
};
const NIGHT = {
  daylight: 0, duskStrength: 0, sunColor: 0xa6baf0,
  hemiSky: 0x839fca, hemiGround: 0x344653, fogColor: 0x18283f, fillColor: 0x91afdd,
  sunIntensity: 0, hemiIntensity: .82, fillIntensity: .5,
  // The campus camera sits about 140 m from the opposite skyline. Preserve
  // distant silhouettes at night instead of dissolving the entire city.
  fogNear: 55, fogFar: 190, exposure: 1.04,
};
const KEYFRAMES = [
  [0, MORNING], [2 / 24, DAY], [8 / 24, DAY], [10 / 24, AFTERNOON],
  [DUSK_START, SUNSET], [NIGHT_START, NIGHT], [DAWN_START, NIGHT], [1, MORNING],
];

function finiteNumber(value, name) {
  if (typeof value !== 'number') throw new TypeError(`${name} must be a number.`);
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
  return value;
}

function validateDuration(seconds) {
  finiteNumber(seconds, 'durationSeconds');
  if (seconds < DAY_CYCLE_LIMITS.min || seconds > DAY_CYCLE_LIMITS.max) {
    throw new RangeError(`durationSeconds must be between ${DAY_CYCLE_LIMITS.min} and ${DAY_CYCLE_LIMITS.max}.`);
  }
  return seconds;
}

function wrap(value) {
  const remainder = value % 1;
  const normalized = remainder < 0 ? remainder + 1 : remainder;
  // Summing frame deltas can leave a completed day one floating-point step
  // short of 1. Snap only that numerical residue, not elapsed simulation time.
  return normalized >= 1 - Number.EPSILON * 4 || normalized === 0 ? 0 : normalized;
}

function smoothstep(value) { return value * value * (3 - 2 * value); }
function mix(a, b, amount) { return a + (b - a) * amount; }
function mixHex(a, b, amount) {
  let color = 0;
  for (const shift of [16, 8, 0]) color |= Math.round(mix((a >>> shift) & 255, (b >>> shift) & 255, amount)) << shift;
  return color;
}

function phaseAt(time) {
  const rounded = time + Number.EPSILON * 4;
  if (rounded >= DAWN_START) return ['dawn', 'Amanhecer'];
  if (rounded >= NIGHT_START) return ['night', 'Noite'];
  if (rounded >= DUSK_START) return ['dusk', 'Pôr do sol'];
  if (rounded >= 6 / 24) return ['afternoon', 'Tarde'];
  return ['day', 'Dia'];
}

/**
 * Every method returns a detached snapshot. Colors are numeric sRGB hex values
 * suitable for THREE.Color.setHex(); sunPosition is relative to a target at y=5.
 * Pausing this clock is independent from agent activity or document visibility.
 */
export function createDayCycle({ durationSeconds = DAY_CYCLE_LIMITS.default, initialTime = .25, running = true } = {}) {
  let duration = validateDuration(durationSeconds);
  let time = wrap(finiteNumber(initialTime, 'initialTime'));
  if (typeof running !== 'boolean') throw new TypeError('running must be a boolean.');
  let isRunning = running;

  function getSnapshot() {
    const upperIndex = KEYFRAMES.findIndex(([at]) => at > time);
    const [start, from] = KEYFRAMES[upperIndex - 1];
    const [end, to] = KEYFRAMES[upperIndex];
    const blend = smoothstep((time - start) / (end - start));
    const [phase, phaseLabel] = phaseAt(time);
    const clockMinutes = Math.floor((time * 1440 + 360 + 1e-9) % 1440);
    const hours = Math.floor(clockMinutes / 60);
    const clock = `${String(hours).padStart(2, '0')}:${String(clockMinutes % 60).padStart(2, '0')}`;
    const angle = time * Math.PI * 2;
    const snapshot = {
      time, durationSeconds: duration, running: isRunning, phase, phaseLabel, clock, clockMinutes,
      // Keep the shadow camera above the ground at the horizon; its intensity
      // reaches zero at night, leaving a stable moon-coloured fill direction.
      sunPosition: { x: -Math.cos(angle) * 40, y: 5 + Math.max(.08, Math.sin(angle)) * 42, z: 22 },
    };
    for (const field of COLOR_FIELDS) snapshot[field] = mixHex(from[field], to[field], blend);
    for (const field of NUMBER_FIELDS) snapshot[field] = mix(from[field], to[field], blend);
    snapshot.nightFactor = 1 - snapshot.daylight;
    return snapshot;
  }

  return {
    getSnapshot,
    update(dt) {
      finiteNumber(dt, 'dt');
      if (dt < 0) throw new RangeError('dt cannot be negative.');
      if (isRunning && dt > 0) time = wrap(time + (dt % duration) / duration);
      return getSnapshot();
    },
    setTime(normalized) {
      time = wrap(finiteNumber(normalized, 'time'));
      return getSnapshot();
    },
    setDuration(seconds) {
      duration = validateDuration(seconds);
      return getSnapshot();
    },
    setRunning(value) {
      if (typeof value !== 'boolean') throw new TypeError('running must be a boolean.');
      isRunning = value;
      return getSnapshot();
    },
  };
}
