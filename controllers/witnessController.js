const fs = require('fs');
const witnessDynamoRepository = require('../repositories/dynamodb/witnessDynamoRepository');
const { resolveTenantId } = require('../utils/tenant');
const { resolveWitnessImageFile } = require('../utils/privateUpload');

const getWitnessIdImage = async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const witness = await witnessDynamoRepository.getById(tenantId, req.params.id);
    if (!witness) return res.status(404).json({ error: 'Witness not found' });

    const file = resolveWitnessImageFile(witness.id_image_path);
    if (!file || !fs.existsSync(file)) {
      return res.status(404).json({ error: 'ID image not found' });
    }

    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type('jpeg');
    return res.sendFile(file);
  } catch (error) {
    console.error('Witness image error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { getWitnessIdImage };
