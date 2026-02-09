const path = require('path');
const BaseExecutor = require('./baseExecutor');
const { runUserPythonStep } = require('../executorBridge');

class PythonExecutor extends BaseExecutor {
  constructor(options = {}) {
    super('PYTHON');
    this.fs = options.fs || require('fs/promises');
    this.path = options.path || path;
  }

  async run(context) {
    const { step, artifactDir, repoRoot, logEvent, addArtifact, settings, registerCancelHandler } = context;
    const payload = step.payload || {};
    const code = String(payload.code || '').trim();
    if (!code) {
      throw new Error(`PYTHON step ${step.id || 'unknown'} has no code payload`);
    }

    const mode = String(payload.mode || 'safe').trim().toLowerCase();
    const snippet = code.length > 256 ? `${code.slice(0, 256)}...` : code;
    const artifactPath = this.path.join(artifactDir, 'python_step.txt');
    await this.fs.writeFile(artifactPath, code, 'utf8');
    await runUserPythonStep({ step, settings, logEvent, registerCancelHandler });

    if (typeof logEvent === 'function') {
      await logEvent('protocol_python', {
        mode,
        snippet,
        stepId: step.id,
      });
    }

    if (typeof addArtifact === 'function') {
      const relative = repoRoot ? this.path.relative(repoRoot, artifactPath) : artifactPath;
      await addArtifact({
        kind: 'python',
        path: relative,
        description: `Python code captured for step ${step.id || 'unknown'}`,
      });
    }
  }
}

const createPythonExecutor = (options) => new PythonExecutor(options);

module.exports = createPythonExecutor;
