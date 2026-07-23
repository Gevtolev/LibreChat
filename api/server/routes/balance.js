const express = require('express');
const router = express.Router();
const controller = require('../controllers/Balance');
const { requireJwtAuth, denyGuestRole } = require('../middleware/');

router.get('/', requireJwtAuth, denyGuestRole, controller);

module.exports = router;
