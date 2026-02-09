const { spawn } = require('child_process');
const os = require('os');

const killProcessTree = async (child) => {
  if (!child || !child.pid) return;

  if (os.platform() === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
      });
      killer.on('error', () => resolve());
      killer.on('exit', () => resolve());
    });
    return;
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // no-op
    }
  }
};

const safeParseInt = (value, fallback) => {
  const n = Number.parseInt(String(value), 10);
  if (Number.isNaN(n)) return fallback;
  return n;
};

const nowIso = () => new Date().toISOString();

module.exports = {
  killProcessTree,
  safeParseInt,
  nowIso,
};
