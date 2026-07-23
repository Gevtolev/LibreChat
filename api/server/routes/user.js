const express = require('express');
const {
  updateUserPluginsController,
  resendVerificationController,
  getTermsStatusController,
  acceptTermsController,
  verifyEmailController,
  deleteUserController,
  getUserController,
} = require('~/server/controllers/UserController');
const {
  verifyEmailLimiter,
  configMiddleware,
  canDeleteAccount,
  requireJwtAuth,
  denyGuestRole,
} = require('~/server/middleware');

const settings = require('./settings');

const router = express.Router();

/**
 * `GET /` (own profile) and `/settings` (preferences like favorites/skill toggles) stay open
 * for GUEST — AuthContext's own user-fetch and normal in-session UX depend on them. Only
 * account-management operations that don't make sense for an anonymous placeholder are
 * blocked: configuring persistent tool credentials and deleting the account.
 */
router.use('/settings', requireJwtAuth, settings);
router.get('/', requireJwtAuth, getUserController);
router.get('/terms', requireJwtAuth, getTermsStatusController);
router.post('/terms/accept', requireJwtAuth, acceptTermsController);
router.post('/plugins', requireJwtAuth, denyGuestRole, updateUserPluginsController);
router.delete(
  '/delete',
  requireJwtAuth,
  denyGuestRole,
  canDeleteAccount,
  configMiddleware,
  deleteUserController,
);
router.post('/verify', verifyEmailController);
router.post('/verify/resend', verifyEmailLimiter, resendVerificationController);

module.exports = router;
