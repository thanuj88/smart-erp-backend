const crypto = require('crypto');
const path = require('path');
const { saveImage } = require('./saveImage');

const UPLOADS_ROOT = path.resolve(__dirname, '../uploads');
const PRIVATE_DIR = path.resolve(UPLOADS_ROOT, 'private', 'witnesses');
const LEGACY_DIR = path.resolve(UPLOADS_ROOT, 'witnesses');

/** Public /uploads must not serve ID photos. Product and receipt images stay public. */
function isBlockedUploadPath(urlPath) {
  const value = String(urlPath || '');
  return (
    value === '/witnesses' ||
    value.startsWith('/witnesses/') ||
    value === '/private' ||
    value.startsWith('/private/')
  );
}

function savePrivateWitnessImage(base64Data) {
  if (!base64Data) return null;
  const filename = `${crypto.randomBytes(16).toString('hex')}.jpg`;
  const written = saveImage(base64Data, 'private/witnesses', filename);
  if (!written) return null;
  return `private/witnesses/${filename}`;
}

function resolveWitnessImageFile(storedPath) {
  if (!storedPath || typeof storedPath !== 'string') return null;
  const normalized = storedPath.replace(/\\/g, '/').trim();
  let relative = null;
  if (normalized.startsWith('private/witnesses/')) relative = normalized;
  else if (normalized.startsWith('/uploads/witnesses/')) relative = normalized.slice('/uploads/'.length);
  else return null;
  if (relative.includes('..')) return null;

  const filename = relative.slice(relative.lastIndexOf('/') + 1);
  if (!/^[A-Za-z0-9_.-]+$/.test(filename)) return null;

  const full = path.resolve(UPLOADS_ROOT, ...relative.split('/'));
  const allowed = [PRIVATE_DIR + path.sep, LEGACY_DIR + path.sep];
  if (!allowed.some((dir) => full.startsWith(dir))) return null;
  return full;
}

module.exports = {
  isBlockedUploadPath,
  savePrivateWitnessImage,
  resolveWitnessImageFile,
};
