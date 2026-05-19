const DEFAULT_PORT = 3123;
const DEFAULT_HOST = "127.0.0.1";

function resolveDesktopUrl(env = process.env, port = DEFAULT_PORT) {
  const configured = env.HWP_AI_DESKTOP_URL && env.HWP_AI_DESKTOP_URL.trim();
  return configured || `http://${DEFAULT_HOST}:${port}`;
}

function shouldStartLocalNextServer(env = process.env) {
  return !Boolean(env.HWP_AI_DESKTOP_URL && env.HWP_AI_DESKTOP_URL.trim());
}

function buildNextServerOptions(options = {}) {
  return {
    dev: !Boolean(options.packaged),
    dir: options.appRoot,
    hostname: options.host || DEFAULT_HOST,
    port: options.port || DEFAULT_PORT,
  };
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  buildNextServerOptions,
  resolveDesktopUrl,
  shouldStartLocalNextServer,
};
