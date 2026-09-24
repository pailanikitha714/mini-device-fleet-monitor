/**
 * Input validation for request bodies.
 * Each function returns either { error: string } or { value: cleanedInput }.
 */

// Letters, numbers, "-" and "_" only, so ids are always safe to use in URLs.
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateRegistration(body) {
  if (!isPlainObject(body)) {
    return { error: 'Request body must be a JSON object' };
  }

  const { id, name } = body;

  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    return {
      error: "'id' is required and must be 1-64 characters (letters, numbers, '-' or '_')",
    };
  }

  if (typeof name !== 'string' || name.trim() === '') {
    return { error: "'name' is required and must be a non-empty string" };
  }

  return { value: { id, name: name.trim() } };
}

function validateHeartbeat(body) {
  if (!isPlainObject(body)) {
    return { error: 'Request body must be a JSON object' };
  }

  const { timestamp, status, cpu_usage: cpuUsage, signal_strength: signalStrength } = body;

  if (timestamp !== undefined
    && (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp)))) {
    return { error: "'timestamp' must be a valid ISO 8601 date string" };
  }

  if (status !== undefined && (typeof status !== 'string' || status.trim() === '')) {
    return { error: "'status' must be a non-empty string" };
  }

  if (cpuUsage !== undefined
    && (typeof cpuUsage !== 'number' || !Number.isFinite(cpuUsage) || cpuUsage < 0 || cpuUsage > 100)) {
    return { error: "'cpu_usage' must be a number between 0 and 100" };
  }

  if (signalStrength !== undefined
    && (typeof signalStrength !== 'number' || !Number.isFinite(signalStrength))) {
    return { error: "'signal_strength' must be a number" };
  }

  return {
    value: {
      timestamp: timestamp === undefined ? null : timestamp,
      status: status === undefined ? 'OK' : status.trim(),
      cpu_usage: cpuUsage === undefined ? null : cpuUsage,
      signal_strength: signalStrength === undefined ? null : signalStrength,
    },
  };
}

module.exports = { validateRegistration, validateHeartbeat };