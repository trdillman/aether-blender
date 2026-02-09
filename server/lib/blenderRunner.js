const { spawn } = require('child_process');
const path = require('path');
const { killProcessTree, nowIso } = require('./utils');

const toCommandText = (executable, args) => [executable].concat(args).join(' ');

const splitLines = (buffered, chunk) => {
  const text = buffered + String(chunk || '');
  const lines = text.split(/\r?\n/);
  return {
    lines: lines.slice(0, -1),
    rest: lines[lines.length - 1] || '',
  };
};

const buildArgs = ({ mode, harnessPath, addonPath }) => {
  const resolvedHarness = path.resolve(harnessPath);
  const resolvedAddon = path.resolve(addonPath);
  const base = ['-P', resolvedHarness, '--', resolvedAddon];

  if (mode === 'gui') {
    return base;
  }

  return ['-b'].concat(base);
};

const runBlender = ({
  blenderPath,
  mode,
  harnessPath,
  addonPath,
  cwd,
  onStarted,
  onLog,
  onExit,
}) => {
  const args = buildArgs({ mode, harnessPath, addonPath });
  const command = toCommandText(blenderPath, args);
  const child = spawn(blenderPath, args, {
    cwd,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });

  let stdoutBuf = '';
  let stderrBuf = '';
  let finished = false;

  const pushLogLine = (stream, line) => {
    if (typeof onLog === 'function') {
      onLog({
        type: 'blender_log',
        stream,
        line,
        timestamp: nowIso(),
      });
    }
  };

  const flushBuffer = (stream) => {
    if (stream === 'stdout' && stdoutBuf) {
      pushLogLine('stdout', stdoutBuf);
      stdoutBuf = '';
      return;
    }

    if (stream === 'stderr' && stderrBuf) {
      pushLogLine('stderr', stderrBuf);
      stderrBuf = '';
    }
  };

  child.stdout.on('data', (chunk) => {
    const result = splitLines(stdoutBuf, chunk);
    stdoutBuf = result.rest;
    for (const line of result.lines) {
      pushLogLine('stdout', line);
    }
  });

  child.stderr.on('data', (chunk) => {
    const result = splitLines(stderrBuf, chunk);
    stderrBuf = result.rest;
    for (const line of result.lines) {
      pushLogLine('stderr', line);
    }
  });

  const done = new Promise((resolve) => {
    child.on('error', (error) => {
      if (finished) {
        return;
      }

      finished = true;
      flushBuffer('stdout');
      flushBuffer('stderr');
      const result = {
        ok: false,
        code: null,
        signal: null,
        error,
        command,
        args,
      };
      if (typeof onExit === 'function') {
        onExit(result);
      }
      resolve(result);
    });

    child.on('close', (code, signal) => {
      if (finished) {
        return;
      }

      finished = true;
      flushBuffer('stdout');
      flushBuffer('stderr');
      const result = {
        ok: code === 0,
        code,
        signal,
        error: null,
        command,
        args,
      };
      if (typeof onExit === 'function') {
        onExit(result);
      }
      resolve(result);
    });
  });

  if (typeof onStarted === 'function') {
    onStarted({
      type: 'blender_started',
      pid: child.pid,
      mode,
      command,
      args,
      timestamp: nowIso(),
    });
  }

  const cancel = async () => {
    await killProcessTree(child);
  };

  return {
    child,
    cancel,
    done,
    command,
    args,
  };
};

module.exports = {
  buildArgs,
  runBlender,
};
