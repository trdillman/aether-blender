const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { executeProtocolPlan } = require('./protocolExecutor');
const blenderSessionManager = require('./blenderSessionManager');

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const createValidationError = (message) => {
  const error = new Error(message);
  error.code = 'MANIFEST_E2E_VALIDATION_ERROR';
  error.statusCode = 400;
  return error;
};

const normalizeStringArray = (value, fieldName) => {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw createValidationError(`${fieldName} must be an array of strings.`);
  }
  return value.map((item, index) => {
    const normalized = String(item || '').trim();
    if (!normalized) {
      throw createValidationError(`${fieldName}[${index}] must be a non-empty string.`);
    }
    return normalized;
  });
};

const normalizeSceneObjects = (value) => {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw createValidationError('assertions.scene.objects must be an array when provided.');
  }

  return value.map((entry, index) => {
    if (!isObject(entry)) {
      throw createValidationError(`assertions.scene.objects[${index}] must be an object.`);
    }

    const objectName = String(entry.objectName || '').trim();
    if (!objectName) {
      throw createValidationError(`assertions.scene.objects[${index}].objectName is required.`);
    }

    return {
      objectName,
      modifierTypes: normalizeStringArray(entry.modifierTypes, `assertions.scene.objects[${index}].modifierTypes`),
      nodeTypes: normalizeStringArray(entry.nodeTypes, `assertions.scene.objects[${index}].nodeTypes`),
    };
  });
};

const validateManifest = (manifest) => {
  if (!isObject(manifest)) {
    throw createValidationError('Manifest must be a JSON object.');
  }

  const id = String(manifest.id || '').trim();
  if (!id) {
    throw createValidationError('Manifest id is required.');
  }

  if (!isObject(manifest.protocol) || !Array.isArray(manifest.protocol.steps)) {
    throw createValidationError('Manifest protocol must be an object with a steps array.');
  }

  const assertions = isObject(manifest.assertions) ? manifest.assertions : {};
  const eventAssertions = isObject(assertions.events) ? assertions.events : {};
  const sceneAssertions = isObject(assertions.scene) ? assertions.scene : {};
  const options = isObject(manifest.options) ? manifest.options : {};

  const requireEventTypes = normalizeStringArray(
    eventAssertions.requireEventTypes,
    'assertions.events.requireEventTypes',
  );

  const sceneObjects = normalizeSceneObjects(sceneAssertions.objects);

  return {
    id,
    description: String(manifest.description || '').trim(),
    protocol: manifest.protocol,
    assertions: {
      events: {
        requireEventTypes,
      },
      scene: {
        objects: sceneObjects,
      },
    },
    options: {
      requireActiveRpcSession: options.requireActiveRpcSession !== false,
      timeoutMs: Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 120000,
      allowTrustedPythonExecution: options.allowTrustedPythonExecution === true,
    },
  };
};

const loadManifest = async (manifestPath) => {
  const absolutePath = path.resolve(manifestPath);
  const raw = await fs.readFile(absolutePath, 'utf8');

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw createValidationError(`Failed to parse manifest JSON: ${error.message}`);
  }

  return {
    manifest: validateManifest(parsed),
    path: absolutePath,
  };
};

const buildSceneVerificationScript = ({ objects }) => {
  const serialized = JSON.stringify(objects);

  const script = `
_expected_objects = ${serialized}

errors = []

for spec in _expected_objects:
    object_name = str(spec.get('objectName') or '')
    obj = bpy.data.objects.get(object_name)
    if obj is None:
        errors.append('Missing object: ' + object_name)
        continue

    modifier_types = [str(mod.type) for mod in obj.modifiers]
    for expected_mod in spec.get('modifierTypes') or []:
        if str(expected_mod) not in modifier_types:
            errors.append('Object ' + object_name + ' missing modifier type: ' + str(expected_mod))

    expected_node_types = spec.get('nodeTypes') or []
    if expected_node_types:
        nodes_modifier = None
        for mod in obj.modifiers:
            if str(mod.type) == 'NODES' and getattr(mod, 'node_group', None) is not None:
                nodes_modifier = mod
                break

        if nodes_modifier is None:
            errors.append('Object ' + object_name + ' has no NODES modifier with node_group')
            continue

        found_types = set()
        for node in nodes_modifier.node_group.nodes:
            found_types.add(str(node.bl_idname))

        for expected_node in expected_node_types:
            if str(expected_node) not in found_types:
                errors.append('Object ' + object_name + ' missing node type: ' + str(expected_node))

if errors:
    raise Exception('Manifest scene assertions failed: ' + '; '.join(errors))
`.trim();

  return script;
};

const runManifest = async ({
  manifest,
  repoRoot,
  runDir,
  settings,
  executeProtocolPlanImpl,
  blenderSessionManagerImpl,
}) => {
  const validated = validateManifest(manifest);
  const run = {
    id: `${validated.id}_${crypto.randomBytes(3).toString('hex')}`,
    events: [],
    artifacts: [],
    steps: {},
  };

  const sessionManager = blenderSessionManagerImpl || blenderSessionManager;
  const executeProtocol = executeProtocolPlanImpl || executeProtocolPlan;

  const startStep = async (_run, stepId, stepName) => {
    run.steps[stepId] = {
      id: stepId,
      name: stepName,
      status: 'running',
    };
  };

  const completeStep = async (_run, stepId) => {
    if (!run.steps[stepId]) {
      run.steps[stepId] = { id: stepId, status: 'completed' };
      return;
    }
    run.steps[stepId].status = 'completed';
  };

  const failStep = (_run, stepId, error) => {
    if (!run.steps[stepId]) {
      run.steps[stepId] = { id: stepId };
    }
    run.steps[stepId].status = 'failed';
    run.steps[stepId].error = String(error && error.message ? error.message : error);
  };

  const appendEvent = async (_run, type, payload) => {
    run.events.push({ type, ...(payload || {}) });
  };

  const addArtifact = async (_run, artifact) => {
    run.artifacts.push({ ...(artifact || {}) });
  };

  await executeProtocol({
    protocol: validated.protocol,
    run,
    runDir: path.resolve(runDir),
    repoRoot: path.resolve(repoRoot),
    settings: settings || {},
    startStep,
    completeStep,
    failStep,
    appendEvent,
    addArtifact,
    executeWithCancellation: async (_runCtx, promise) => promise,
    registerCancelHandler: () => () => {},
    traceSpanRecorder: async () => {},
  });

  const observedEventTypes = new Set(run.events.map((evt) => String(evt.type || '')));
  const missingEvents = validated.assertions.events.requireEventTypes.filter((type) => !observedEventTypes.has(type));

  if (missingEvents.length > 0) {
    throw new Error(`Manifest assertion failed: missing required events: ${missingEvents.join(', ')}`);
  }

  const sceneObjects = validated.assertions.scene.objects;
  if (sceneObjects.length > 0) {
    const activeSession =
      sessionManager && typeof sessionManager.getActiveSession === 'function'
        ? sessionManager.getActiveSession()
        : null;

    if (!activeSession && validated.options.requireActiveRpcSession) {
      throw new Error('Manifest scene assertions require an active Blender RPC session.');
    }

    if (activeSession) {
      const verificationScript = buildSceneVerificationScript({ objects: sceneObjects });
      const mode = validated.options.allowTrustedPythonExecution ? 'trusted' : 'safe';
      await sessionManager.executeOnActive(
        'exec_python',
        {
          code: verificationScript,
          mode,
        },
        validated.options.timeoutMs,
      );
    }
  }

  return {
    ok: true,
    runId: run.id,
    manifestId: validated.id,
    stepCount: Object.keys(run.steps).length,
    eventCount: run.events.length,
    artifactCount: run.artifacts.length,
    observedEventTypes: Array.from(observedEventTypes),
  };
};

module.exports = {
  validateManifest,
  loadManifest,
  runManifest,
  buildSceneVerificationScript,
};
