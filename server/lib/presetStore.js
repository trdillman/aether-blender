const crypto = require('crypto');
const path = require('path');
const { PRESETS_FILE } = require('./constants');
const { ensureDir, readJson, writeJson } = require('./fsUtils');
const { validateProtocolPlan } = require('./protocolValidator');
const { createTaxonomyError } = require('./errorTaxonomy');

const PRESET_SCHEMA_VERSION = '1.0';
const PRESET_BUNDLE_VERSION = '1.0';
const PRESET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;

let initialized = false;
let presetsCache = [];
const PRESETS_FILE_PATH =
  process.env.AETHER_PRESETS_FILE && String(process.env.AETHER_PRESETS_FILE).trim()
    ? path.resolve(String(process.env.AETHER_PRESETS_FILE).trim())
    : PRESETS_FILE;

const deepClone = (value) => JSON.parse(JSON.stringify(value));
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const nowIso = () => new Date().toISOString();

const generatePresetId = (name = 'preset') => {
  const normalized = String(name || 'preset')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'preset';
  const suffix = crypto.randomBytes(4).toString('hex');
  return `${normalized}-${suffix}`;
};

const isIsoDateString = (value) => {
  if (typeof value !== 'string' || !value.trim()) return false;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return false;
  return new Date(timestamp).toISOString() === value;
};

const pushValidationError = (errors, code, pathValue, message) => {
  errors.push({
    code,
    path: pathValue,
    message,
  });
};

const migratePresetToCurrent = (input) => {
  if (!isObject(input)) {
    return input;
  }

  if (String(input.schemaVersion || '') === PRESET_SCHEMA_VERSION) {
    return deepClone(input);
  }

  const migrated = {
    schemaVersion: PRESET_SCHEMA_VERSION,
    id:
      input.id ||
      input.presetId ||
      input.slug ||
      input.key ||
      generatePresetId(input.name || input.title || input.presetName || 'preset'),
    name: input.name || input.title || input.presetName || 'Imported Preset',
    description: input.description || input.notes || '',
    tags: Array.isArray(input.tags) ? input.tags : Array.isArray(input.labels) ? input.labels : [],
    createdAt: input.createdAt || input.created_at || input.exportedAt || nowIso(),
    updatedAt: input.updatedAt || input.updated_at || input.modifiedAt || input.createdAt || nowIso(),
    protocol: input.protocol || input.protocolPayload || input.payload || input.plan || null,
  };

  return migrated;
};

const validatePreset = (input, options = {}) => {
  const pathPrefix = String(options.pathPrefix || 'preset');
  const errors = [];
  const migratedInput = options.allowMigration ? migratePresetToCurrent(input) : deepClone(input);

  if (!isObject(migratedInput)) {
    pushValidationError(errors, 'PRESET_OBJECT_REQUIRED', pathPrefix, 'Preset must be an object.');
    return { ok: false, errors };
  }

  const allowedFields = new Set([
    'schemaVersion',
    'id',
    'name',
    'description',
    'tags',
    'createdAt',
    'updatedAt',
    'protocol',
    'metadata',
    'sourceRunId',
  ]);
  for (const key of Object.keys(migratedInput)) {
    if (!allowedFields.has(key)) {
      pushValidationError(
        errors,
        'PRESET_UNKNOWN_FIELD',
        `${pathPrefix}.${key}`,
        `Unknown preset field "${key}".`,
      );
    }
  }

  const id = String(migratedInput.id || '').trim();
  if (!id) {
    pushValidationError(errors, 'PRESET_ID_REQUIRED', `${pathPrefix}.id`, 'Preset id is required.');
  } else if (!PRESET_ID_PATTERN.test(id)) {
    pushValidationError(
      errors,
      'PRESET_ID_INVALID',
      `${pathPrefix}.id`,
      'Preset id must match [A-Za-z0-9][A-Za-z0-9._-]{0,127}.',
    );
  }

  const name = String(migratedInput.name || '').trim();
  if (!name) {
    pushValidationError(errors, 'PRESET_NAME_REQUIRED', `${pathPrefix}.name`, 'Preset name is required.');
  } else if (name.length > MAX_NAME_LENGTH) {
    pushValidationError(
      errors,
      'PRESET_NAME_TOO_LONG',
      `${pathPrefix}.name`,
      `Preset name must be <= ${MAX_NAME_LENGTH} characters.`,
    );
  }

  const schemaVersion = String(migratedInput.schemaVersion || '').trim();
  if (schemaVersion !== PRESET_SCHEMA_VERSION) {
    pushValidationError(
      errors,
      'PRESET_SCHEMA_VERSION_INVALID',
      `${pathPrefix}.schemaVersion`,
      `Preset schemaVersion must be "${PRESET_SCHEMA_VERSION}".`,
    );
  }

  const description = String(migratedInput.description || '').trim();
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    pushValidationError(
      errors,
      'PRESET_DESCRIPTION_TOO_LONG',
      `${pathPrefix}.description`,
      `Preset description must be <= ${MAX_DESCRIPTION_LENGTH} characters.`,
    );
  }

  const tags = migratedInput.tags;
  const normalizedTags = [];
  if (tags !== undefined) {
    if (!Array.isArray(tags)) {
      pushValidationError(
        errors,
        'PRESET_TAGS_INVALID',
        `${pathPrefix}.tags`,
        'Preset tags must be an array of strings.',
      );
    } else if (tags.length > MAX_TAGS) {
      pushValidationError(
        errors,
        'PRESET_TAGS_TOO_MANY',
        `${pathPrefix}.tags`,
        `Preset tags must contain <= ${MAX_TAGS} entries.`,
      );
    } else {
      const dedupe = new Set();
      tags.forEach((tag, index) => {
        const normalizedTag = String(tag || '').trim();
        if (!normalizedTag) {
          pushValidationError(
            errors,
            'PRESET_TAG_INVALID',
            `${pathPrefix}.tags[${index}]`,
            'Preset tag entries must be non-empty strings.',
          );
          return;
        }
        if (normalizedTag.length > MAX_TAG_LENGTH) {
          pushValidationError(
            errors,
            'PRESET_TAG_TOO_LONG',
            `${pathPrefix}.tags[${index}]`,
            `Preset tag must be <= ${MAX_TAG_LENGTH} characters.`,
          );
          return;
        }
        if (!dedupe.has(normalizedTag)) {
          dedupe.add(normalizedTag);
          normalizedTags.push(normalizedTag);
        }
      });
    }
  }

  const createdAt = String(migratedInput.createdAt || '').trim();
  if (!isIsoDateString(createdAt)) {
    pushValidationError(
      errors,
      'PRESET_CREATED_AT_INVALID',
      `${pathPrefix}.createdAt`,
      'Preset createdAt must be an ISO-8601 UTC timestamp.',
    );
  }

  const updatedAt = String(migratedInput.updatedAt || '').trim();
  if (!isIsoDateString(updatedAt)) {
    pushValidationError(
      errors,
      'PRESET_UPDATED_AT_INVALID',
      `${pathPrefix}.updatedAt`,
      'Preset updatedAt must be an ISO-8601 UTC timestamp.',
    );
  }

  let normalizedProtocol = null;
  if (!isObject(migratedInput.protocol)) {
    pushValidationError(
      errors,
      'PRESET_PROTOCOL_REQUIRED',
      `${pathPrefix}.protocol`,
      'Preset protocol payload must be an object.',
    );
  } else {
    try {
      normalizedProtocol = validateProtocolPlan(migratedInput.protocol);
    } catch (error) {
      pushValidationError(
        errors,
        error.code || 'PRESET_PROTOCOL_INVALID',
        `${pathPrefix}.protocol${error.path ? `.${error.path}` : ''}`,
        error.message || 'Preset protocol payload is invalid.',
      );
    }
  }

  if (errors.length) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      schemaVersion: PRESET_SCHEMA_VERSION,
      id,
      name,
      description,
      tags: normalizedTags,
      createdAt,
      updatedAt,
      protocol: normalizedProtocol,
      metadata: isObject(migratedInput.metadata) ? deepClone(migratedInput.metadata) : null,
      sourceRunId: String(migratedInput.sourceRunId || '').trim() || null,
    },
  };
};

const assertValidPreset = (input, options = {}) => {
  const result = validatePreset(input, options);
  if (result.ok) {
    return result.value;
  }
  throw createTaxonomyError('PRESET_VALIDATION_FAILED', {
    statusCode: 400,
    message: 'Preset payload validation failed.',
    details: {
      errors: result.errors,
    },
  });
};

const ensureInitialized = async () => {
  if (initialized) return;
  await ensureDir(path.dirname(PRESETS_FILE_PATH));
  const persisted = await readJson(PRESETS_FILE_PATH, []);
  if (!Array.isArray(persisted)) {
    throw createTaxonomyError('PRESET_STORAGE_CORRUPT', {
      statusCode: 500,
      message: 'Preset store file must contain an array.',
    });
  }

  presetsCache = persisted.map((item, index) => {
    const result = validatePreset(item, {
      allowMigration: true,
      pathPrefix: `presets[${index}]`,
    });
    if (!result.ok) {
      throw createTaxonomyError('PRESET_STORAGE_CORRUPT', {
        statusCode: 500,
        message: 'Preset store contains invalid preset entries.',
        details: {
          errors: result.errors,
        },
      });
    }
    return result.value;
  });
  await writeJson(PRESETS_FILE_PATH, presetsCache);
  initialized = true;
};

const persist = async () => {
  await writeJson(PRESETS_FILE_PATH, presetsCache);
};

const listPresets = async () => {
  await ensureInitialized();
  return deepClone(presetsCache);
};

const getPreset = async (id) => {
  await ensureInitialized();
  const normalizedId = String(id || '').trim();
  const found = presetsCache.find((preset) => preset.id === normalizedId);
  return found ? deepClone(found) : null;
};

const upsertPreset = async (input, options = {}) => {
  await ensureInitialized();
  const now = nowIso();
  const merged = isObject(input) ? deepClone(input) : input;
  if (isObject(merged)) {
    if (!merged.createdAt) {
      merged.createdAt = now;
    }
    merged.updatedAt = now;
    if (!merged.id && merged.name) {
      merged.id = generatePresetId(merged.name);
    }
    merged.schemaVersion = PRESET_SCHEMA_VERSION;
  }
  const normalized = assertValidPreset(merged, {
    allowMigration: options.allowMigration !== false,
    pathPrefix: 'preset',
  });

  const existingIndex = presetsCache.findIndex((preset) => preset.id === normalized.id);
  if (existingIndex === -1) {
    presetsCache.unshift(normalized);
  } else {
    normalized.createdAt = presetsCache[existingIndex].createdAt;
    presetsCache[existingIndex] = normalized;
  }
  await persist();
  return deepClone(normalized);
};

const createPreset = async (input, options = {}) => {
  const payload = isObject(input) ? { ...input } : input;
  if (isObject(payload) && payload.id) {
    delete payload.id;
  }
  return upsertPreset(payload, options);
};

const deletePreset = async (id) => {
  await ensureInitialized();
  const normalizedId = String(id || '').trim();
  if (!normalizedId) return false;
  const before = presetsCache.length;
  presetsCache = presetsCache.filter((preset) => preset.id !== normalizedId);
  if (presetsCache.length === before) return false;
  await persist();
  return true;
};

const parsePresetBundle = (bundleInput, options = {}) => {
  let parsed = bundleInput;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {
        ok: false,
        errors: [
          {
            code: 'PRESET_BUNDLE_JSON_INVALID',
            path: 'bundle',
            message: 'Preset bundle string is not valid JSON.',
          },
        ],
      };
    }
  }

  const errors = [];
  const allowMigration = options.allowMigration !== false;
  let presetItems = [];
  let bundleVersion = PRESET_BUNDLE_VERSION;

  if (Array.isArray(parsed)) {
    presetItems = parsed;
    bundleVersion = '0.9';
  } else if (isObject(parsed)) {
    if (Array.isArray(parsed.presets)) {
      presetItems = parsed.presets;
      bundleVersion = String(parsed.bundleVersion || parsed.version || PRESET_BUNDLE_VERSION);
    } else if (Array.isArray(parsed.items)) {
      presetItems = parsed.items;
      bundleVersion = String(parsed.bundleVersion || parsed.version || '0.9');
    } else {
      pushValidationError(
        errors,
        'PRESET_BUNDLE_PRESETS_REQUIRED',
        'bundle.presets',
        'Preset bundle must include a presets array.',
      );
    }
  } else {
    pushValidationError(
      errors,
      'PRESET_BUNDLE_OBJECT_REQUIRED',
      'bundle',
      'Preset bundle must be an object or array.',
    );
  }

  const normalizedPresets = [];
  presetItems.forEach((preset, index) => {
    const result = validatePreset(preset, {
      allowMigration,
      pathPrefix: `bundle.presets[${index}]`,
    });
    if (!result.ok) {
      errors.push(...result.errors);
      return;
    }
    normalizedPresets.push(result.value);
  });

  if (errors.length) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      bundleVersion: PRESET_BUNDLE_VERSION,
      exportedAt: nowIso(),
      presetSchemaVersion: PRESET_SCHEMA_VERSION,
      metadata: {
        source: 'aether-server',
        importedBundleVersion: bundleVersion,
      },
      presets: normalizedPresets,
    },
  };
};

const exportPresetBundle = async (options = {}) => {
  await ensureInitialized();
  const selectedIds = Array.isArray(options.ids)
    ? new Set(options.ids.map((value) => String(value || '').trim()).filter(Boolean))
    : null;
  const presets = selectedIds
    ? presetsCache.filter((preset) => selectedIds.has(preset.id))
    : presetsCache;
  return {
    bundleVersion: PRESET_BUNDLE_VERSION,
    exportedAt: nowIso(),
    presetSchemaVersion: PRESET_SCHEMA_VERSION,
    metadata: {
      source: 'aether-server',
      count: presets.length,
    },
    presets: deepClone(presets),
  };
};

const importPresetBundle = async (bundleInput, options = {}) => {
  await ensureInitialized();
  const parsed = parsePresetBundle(bundleInput, {
    allowMigration: options.allowMigration !== false,
  });
  if (!parsed.ok) {
    throw createTaxonomyError('PRESET_BUNDLE_INVALID', {
      statusCode: 400,
      message: 'Preset bundle validation failed.',
      details: {
        errors: parsed.errors,
      },
    });
  }

  const imported = [];
  for (const preset of parsed.value.presets) {
    const index = presetsCache.findIndex((item) => item.id === preset.id);
    if (index === -1) {
      presetsCache.push(preset);
    } else {
      presetsCache[index] = {
        ...preset,
        createdAt: presetsCache[index].createdAt,
      };
    }
    imported.push(preset.id);
  }

  await persist();
  return {
    importedCount: imported.length,
    importedIds: imported,
    bundle: parsed.value,
  };
};

module.exports = {
  PRESET_SCHEMA_VERSION,
  PRESET_BUNDLE_VERSION,
  migratePresetToCurrent,
  validatePreset,
  parsePresetBundle,
  ensureInitialized,
  listPresets,
  getPreset,
  createPreset,
  deletePreset,
  upsertPreset,
  exportPresetBundle,
  importPresetBundle,
};
