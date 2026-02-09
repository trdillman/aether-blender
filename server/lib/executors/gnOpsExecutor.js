const path = require('path');
const BaseExecutor = require('./baseExecutor');
const { runGnOpsStep } = require('../executorBridge');
const { nowIso } = require('../utils');

class GnOpsExecutor extends BaseExecutor {
  constructor(options = {}) {
    super('GN_OPS');
    this.fs = options.fs || require('fs/promises');
    this.path = options.path || path;
  }

  async run(context) {
    const { step, artifactDir, repoRoot, logEvent, addArtifact, settings, registerCancelHandler } = context;
    const ops = Array.isArray(step.payload && step.payload.ops)
      ? step.payload.ops
      : [];
    const state = this.createState(step.payload && step.payload.target);
    this.applyOperations(state, ops);

    const serialized = this.serializeState(state);
    await runGnOpsStep({ step, settings, logEvent, registerCancelHandler });
    const artifactPath = this.path.join(artifactDir, 'gn_ops_state.json');
    await this.fs.writeFile(artifactPath, JSON.stringify(serialized, null, 2), 'utf8');

    if (typeof logEvent === 'function') {
      await logEvent('protocol_gn_ops', {
        summary: `Applied ${ops.length} GN_OPS operation(s).`,
        operations: ops.length,
        targets: Object.keys(serialized.targets || {}),
      });
    }

    if (typeof addArtifact === 'function') {
      const relative = repoRoot ? this.path.relative(repoRoot, artifactPath) : artifactPath;
      await addArtifact({
        kind: 'gn_ops',
        path: relative,
        description: `GN_OPS snapshot for step ${step.id || 'unnamed'}`,
      });
    }
  }

  createState(target = {}) {
    return {
      target: {
        object_name: String(target.object_name || '').trim(),
        modifier_name: String(target.modifier_name || '').trim(),
      },
      targets: {},
      nodes: {},
      links: [],
      inputs: [],
      cleanup: [],
      singleGroupIo: false,
    };
  }

  applyOperations(state, operations) {
    for (const operation of operations) {
      const op = String(operation.op || '').trim();
      switch (op) {
        case 'ensure_target':
          this.applyEnsureTarget(state, operation);
          break;
        case 'ensure_single_group_io':
          this.applyEnsureSingleGroupIo(state);
          break;
        case 'add_node':
          this.applyAddNode(state, operation);
          break;
        case 'remove_node':
          this.applyRemoveNode(state, operation);
          break;
        case 'link':
          this.applyLink(state, operation);
          break;
        case 'unlink':
          this.applyUnlink(state, operation);
          break;
        case 'set_input':
          this.applySetInput(state, operation);
          break;
        case 'cleanup_unused':
          this.applyCleanup(state, operation);
          break;
        default:
          throw new Error(`GN_OPS executor cannot handle op "${op}"`);
      }
    }
  }

  applyEnsureTarget(state, operation) {
    const key = this.targetKey(state.target);
    state.targets[key] = {
      allow_create_modifier: Boolean(operation.allow_create_modifier),
      timestamp: nowIso(),
    };
  }

  applyEnsureSingleGroupIo(state) {
    state.singleGroupIo = true;
  }

  applyAddNode(state, operation) {
    const id = String(operation.id || '').trim();
    if (!id) {
      throw new Error('GN_OPS add_node missing id');
    }
    state.nodes[id] = {
      id,
      bl_idname: operation.bl_idname || null,
      position: {
        x: Number.isFinite(operation.x) ? operation.x : null,
        y: Number.isFinite(operation.y) ? operation.y : null,
      },
      inputs: {},
    };
  }

  applyRemoveNode(state, operation) {
    const nodeId = String(operation.id || '').trim();
    if (!nodeId || !state.nodes[nodeId]) {
      return;
    }
    delete state.nodes[nodeId];
    state.links = state.links.filter(
      (link) => link.from.node_id !== nodeId && link.to.node_id !== nodeId,
    );
  }

  applyLink(state, operation) {
    const link = {
      from: {
        node_id: operation.from.node_id,
        socket_name: operation.from.socket_name,
      },
      to: {
        node_id: operation.to.node_id,
        socket_name: operation.to.socket_name,
      },
    };
    if (!state.links.some((candidate) => this.matchLink(candidate, link))) {
      state.links.push(link);
    }
  }

  applyUnlink(state, operation) {
    const from = String(operation.from.node_id || '').trim();
    const to = String(operation.to.node_id || '').trim();
    state.links = state.links.filter(
      (link) =>
        !(
          link.from.node_id === from &&
          link.from.socket_name === operation.from.socket_name &&
          link.to.node_id === to &&
          link.to.socket_name === operation.to.socket_name
        ),
    );
  }

  applySetInput(state, operation) {
    state.inputs.push({
      node_id: operation.node_id,
      socket_name: operation.socket_name,
      value: operation.value,
    });
    if (state.nodes[operation.node_id]) {
      state.nodes[operation.node_id].inputs[operation.socket_name] = operation.value;
    }
  }

  applyCleanup(state) {
    state.cleanup.push({
      timestamp: nowIso(),
      removed: Object.keys(state.nodes).length,
    });
  }

  targetKey(target) {
    return `${target.object_name || ''}:${target.modifier_name || ''}`;
  }

  matchLink(a, b) {
    return (
      a.from.node_id === b.from.node_id &&
      a.from.socket_name === b.from.socket_name &&
      a.to.node_id === b.to.node_id &&
      a.to.socket_name === b.to.socket_name
    );
  }

  serializeState(state) {
    const targets = {};
    for (const key of Object.keys(state.targets).sort()) {
      targets[key] = state.targets[key];
    }
    const nodes = {};
    for (const key of Object.keys(state.nodes).sort()) {
      nodes[key] = state.nodes[key];
    }
    const links = [...state.links].sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
    return {
      target: state.target,
      targets,
      nodes,
      links,
      inputs: state.inputs,
      cleanup: state.cleanup,
      singleGroupIo: state.singleGroupIo,
    };
  }
}

const createGnOpsExecutor = (options) => new GnOpsExecutor(options);

module.exports = createGnOpsExecutor;
