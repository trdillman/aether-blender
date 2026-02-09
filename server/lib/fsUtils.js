const fs = require('fs/promises');
const fsSync = require('fs');

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const readJson = async (filePath, fallbackValue) => {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return fallbackValue;
    }
    throw error;
  }
};

const writeJson = async (filePath, value) => {
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tempPath, filePath);
};

const exists = (targetPath) => fsSync.existsSync(targetPath);

module.exports = {
  ensureDir,
  readJson,
  writeJson,
  exists,
};
