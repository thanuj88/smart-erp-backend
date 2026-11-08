const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { canWorkInstallments } = require('../middleware/installmentAccess');
const { getWitnessIdImage } = require('../controllers/witnessController');

router.use(authenticate);
router.use(canWorkInstallments);
router.get('/:id/id-image', getWitnessIdImage);

module.exports = router;
