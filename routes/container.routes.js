const express = require('express');
const router = express.Router();
const containerController = require('../controllers/container.controller');
const userController = require('../controllers/user.controller');
const authMiddleware = require('../middleware/auth.middleware');

router.use(authMiddleware);

router.get('/', containerController.getDashboard);
router.get('/container/:id', containerController.getContainerDetail);
router.get('/container/:id/logs', containerController.getHistoricalLogs);
router.get('/container/:id/stream', containerController.streamLogs);

// Any logged-in user can update their own alert email
router.post('/profile/alert-email', userController.updateAlertEmail);

module.exports = router;

