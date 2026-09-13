const path = require('path');
const fs = require('fs');

/**
 * Persist a base64 data-URL image under uploads/{folder}/.
 * @returns {string|null} Public path e.g. /uploads/products/foo.jpg
 */
function saveImage(base64Data, folder, filename) {
  if (!base64Data) return null;

  const uploadsDir = path.join(__dirname, '../uploads', folder);
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const base64Image = base64Data.includes(';base64,')
    ? base64Data.split(';base64,').pop()
    : base64Data;
  const filePath = path.join(uploadsDir, filename);
  fs.writeFileSync(filePath, base64Image, { encoding: 'base64' });
  return `/uploads/${folder}/${filename}`;
}

module.exports = { saveImage };
