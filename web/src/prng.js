let rng = Math.random;
let callCount = 0;

export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function initRng(seed) {
  rng = mulberry32(seed);
  callCount = 0;
}

export function resetRng() {
  rng = Math.random;
  callCount = 0;
}

export function random() {
  callCount += 1;
  return rng();
}

export function randomInt(max) {
  return Math.floor(random() * max);
}

export function rngCallCount() {
  return callCount;
}
