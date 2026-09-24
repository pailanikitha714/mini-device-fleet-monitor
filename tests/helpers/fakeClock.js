/**
 * A controllable clock for tests.
 * Lets tests move time forward instantly instead of waiting in real time.
 */
function createFakeClock(startIso = '2026-09-21T10:30:00.000Z') {
  let current = Date.parse(startIso);

  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
    iso: () => new Date(current).toISOString(),
  };
}

module.exports = { createFakeClock };