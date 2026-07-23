const { SystemRoles } = require('librechat-data-provider');

/**
 * Blocks the anonymous `GUEST` role from routes that only check `requireJwtAuth` and have no
 * `PermissionTypes` gate of their own (e.g. balance, account settings) — a valid JWT alone would
 * otherwise be enough to reach them, anonymous or not.
 */
function denyGuestRole(req, res, next) {
  if (req.user?.role === SystemRoles.GUEST) {
    return res.status(403).json({ message: 'Not available for anonymous accounts' });
  }
  next();
}

module.exports = denyGuestRole;
