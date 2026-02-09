const createGnOpsExecutor = require('./gnOpsExecutor');
const createNodeTreeExecutor = require('./nodeTreeExecutor');
const createPythonExecutor = require('./pythonExecutor');

const factories = new Map();

const registerExecutor = (type, factory) => {
  if (!type || typeof factory !== 'function') {
    throw new Error('Executor registration requires a type and factory function');
  }
  factories.set(type, factory);
};

const getExecutorForStep = (type, context = {}) => {
  const factory = factories.get(type);
  if (!factory) {
    throw new Error(`No executor registered for type "${type}"`);
  }
  return factory(context);
};

registerExecutor('NODE_TREE', (ctx) => createNodeTreeExecutor(ctx));
registerExecutor('GN_OPS', (ctx) => createGnOpsExecutor(ctx));
registerExecutor('PYTHON', (ctx) => createPythonExecutor(ctx));

module.exports = {
  getExecutorForStep,
  registerExecutor,
};
