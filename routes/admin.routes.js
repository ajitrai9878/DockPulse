const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const authMiddleware = require('../middleware/auth.middleware');
const roleMiddleware = require('../middleware/role.middleware');

router.use(authMiddleware);
router.use(roleMiddleware(['admin']));

router.get('/', userController.getAdminDashboard);
router.post('/users/create', userController.createUser);
router.post('/users/:id/update', userController.updateUser);
router.post('/users/:id/delete', userController.deleteUser);
router.post('/users/:id/reset-password', userController.resetPassword);
router.post('/users/:id/alert-email', userController.updateUserAlertEmail);

router.get('/users/:id/assign', userController.getAssignContainers);
router.post('/users/:id/assign', userController.postAssignContainers);

// Admin's own alert email (reuses updateAlertEmail — resolves to session user)
router.post('/settings/alert-email', userController.updateAlertEmail);

module.exports = router;

