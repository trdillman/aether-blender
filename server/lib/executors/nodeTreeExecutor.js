const path = require('path');
const BaseExecutor = require('./baseExecutor');
const { runNodeTreeStep } = require('../executorBridge');

class NodeTreeExecutor extends BaseExecutor {
  constructor(options = {}) {
    super('NODE_TREE');
    this.fs = options.fs || require('fs/promises');
    this.path = options.path || path;
  }

  async run(context) {
    const { step, artifactDir, repoRoot, logEvent, addArtifact, settings, registerCancelHandler } = context;
    const ops = Array.isArray(step.payload && step.payload.operations)
      ? step.payload.operations
      : [];

    const state = this.createState(step.payload && step.payload.target);
    this.applyOperations(state, ops);

    const serialized = this.serializeState(state);
    await runNodeTreeStep({ step, settings, logEvent, registerCancelHandler });
    const artifactPath = this.path.join(artifactDir, 'node_tree_state.json');
    await this.fs.writeFile(artifactPath, JSON.stringify(serialized, null, 2), 'utf8');

    if (typeof logEvent === 'function') {
      await logEvent('protocol_node_tree', {
        summary: `Applied ${ops.length} operation(s) to NODE_TREE target.`,
        operations: ops.length,
        target: serialized.target,
      });
    }

    if (typeof addArtifact === 'function') {
      const relative = repoRoot ? this.path.relative(repoRoot, artifactPath) : artifactPath;
      await addArtifact({
        kind: 'node_tree',
        path: relative,
        description: `Node tree snapshot for step ${step.id || 'unnamed'}`,
      });
    }
  }

  createState(target = {}) {
    return {
      target: {
        object_name: String(target.object_name || '').trim(),
        modifier_name: String(target.modifier_name || '').trim(),
        node_group_name: String(target.node_group_name || '').trim(),
      },
      nodes: {},
      links: [],
      group_io: [],
    };
  }

  applyOperations(state, operations) {
    for (const operation of operations) {
      const op = String(operation.op || '').trim();
      switch (op) {
        case 'create_node':
          this.applyCreateNode(state, operation);
          break;
        case 'delete_node':
          this.applyDeleteNode(state, operation);
          break;
        case 'set_input_default':
          this.applySetInputDefault(state, operation);
          break;
        case 'set_property':
          this.applySetProperty(state, operation);
          break;
        case 'link':
          this.applyLink(state, operation);
          break;
        case 'unlink':
          this.applyUnlink(state, operation);
          break;
        case 'set_group_io':
          this.applySetGroupIo(state, operation);
          break;
        default:
          throw new Error(`NODE_TREE executor does not know how to handle op "${op}"`);
      }
    }
  }

  applyCreateNode(state, operation) {
    const nodeId = String(operation.node_id || '').trim();
    if (!nodeId) {
      throw new Error('NODE_TREE create_node missing node_id');
    }
    if (state.nodes[nodeId]) {
      throw new Error(`NODE_TREE create_node node ${nodeId} already exists`);
    }
    state.nodes[nodeId] = {
      id: nodeId,
      bl_idname: operation.bl_idname || null,
      location: Array.isArray(operation.location) ? operation.location.slice(0, 2) : null,
      properties: {},
      inputs: {},
    };
  }

  applyDeleteNode(state, operation) {
    const node = this.ensureNode(state, operation.node_id, 'delete_node');
    delete state.nodes[node.id];
    state.links = state.links.filter(
      (link) => link.from.node_id !== node.id && link.to.node_id !== node.id,
    );
  }

  applySetInputDefault(state, operation) {
    const node = this.ensureNode(state, operation.node_id, 'set_input_default');
    node.inputs = node.inputs || {};
    node.inputs[operation.socket] = {
      default: operation.value,
    };
  }

  applySetProperty(state, operation) {
    const node = this.ensureNode(state, operation.node_id, 'set_property');
    node.properties = node.properties || {};
    node.properties[operation.property] = operation.value;
  }

  applyLink(state, operation) {
    const from = this.ensureNode(state, operation.from.node_id, 'link');
    const to = this.ensureNode(state, operation.to.node_id, 'link');

    const link = {
      from: { node_id: from.id, socket: operation.from.socket },
      to: { node_id: to.id, socket: operation.to.socket },
    };

    if (!state.links.some((candidate) => this.matchLink(candidate, link))) {
      state.links.push(link);
    }
  }

  applyUnlink(state, operation) {
    const fromId = String(operation.from.node_id || '').trim();
    const toId = String(operation.to.node_id || '').trim();
    state.links = state.links.filter(
      (link) =>
        !(link.from.node_id === fromId && link.to.node_id === toId &&
          link.from.socket === operation.from.socket &&
          link.to.socket === operation.to.socket),
    );
  }

  applySetGroupIo(state, operation) {
    state.group_io.push({
      action: operation.action,
      socket: operation.socket,
      socket_type: operation.socket_type,
    });
  }

  ensureNode(state, nodeId, op) {
    const normalized = String(nodeId || '').trim();
    if (!normalized || !state.nodes[normalized]) {
      throw new Error(`NODE_TREE ${op} missing node ${nodeId}`);
    }
    return state.nodes[normalized];
  }

  matchLink(a, b) {
    return (
      a.from.node_id === b.from.node_id &&
      a.from.socket === b.from.socket &&
      a.to.node_id === b.to.node_id &&
      a.to.socket === b.to.socket
    );
  }

  serializeState(state) {
    const nodes = {};
    for (const key of Object.keys(state.nodes).sort()) {
      nodes[key] = state.nodes[key];
    }
    const links = [...state.links].sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
    return {
      target: state.target,
      nodes,
      links,
      group_io: state.group_io,
    };
  }
}

const createNodeTreeExecutor = (options) => new NodeTreeExecutor(options);

module.exports = createNodeTreeExecutor;
