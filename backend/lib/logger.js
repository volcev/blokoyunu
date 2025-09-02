const DEBUG_LOG = String(process.env.DEBUG_LOG || process.env.VOLCHAIN_DEBUG_LOG || '') === '1';

function debug(...args) {
  if (DEBUG_LOG) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
}

function info(...args) {
  // eslint-disable-next-line no-console
  console.log(...args);
}

function warn(...args) {
  // eslint-disable-next-line no-console
  console.warn(...args);
}

function error(...args) {
  // eslint-disable-next-line no-console
  console.error(...args);
}

module.exports = { debug, info, warn, error };



