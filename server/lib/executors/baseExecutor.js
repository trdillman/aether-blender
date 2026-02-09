class BaseExecutor {
  constructor(type) {
    if (!type || typeof type !== 'string') {
      throw new Error('Executor type must be a non-empty string');
    }
    this.type = type;
  }

  async prepare() {
    return undefined;
  }

  async run() {
    throw new Error(`Executor ${this.type} must implement run()`);
  }

  async cancel() {
    return undefined;
  }

  async cleanup() {
    return undefined;
  }
}

module.exports = BaseExecutor;
