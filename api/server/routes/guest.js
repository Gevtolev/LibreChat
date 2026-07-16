const express = require('express');
const {
  isEnabled,
  getGuestUsageExpiresAt,
  getOrCreateGuestId,
  runGuestChat,
} = require('@librechat/api');
const { logger, getTenantId, isGuestChatEnabled } = require('@librechat/data-schemas');
const optionalJwtAuth = require('~/server/middleware/optionalJwtAuth');
const { uaParser, checkBan, guestChatIpLimiter } = require('~/server/middleware');
const { getAppConfig } = require('~/server/services/Config/app');
const { incrementGuestUsage } = require('~/models');

const router = express.Router();

const MAX_GUEST_TEXT_LENGTH = 4000;
const { LIMIT_MESSAGE_IP } = process.env ?? {};

router.use(optionalJwtAuth);
router.use(uaParser);
router.use(checkBan);

if (isEnabled(LIMIT_MESSAGE_IP)) {
  router.use(guestChatIpLimiter);
}

router.post('/chat', async (req, res) => {
  try {
    /** Blocks the most common cross-site form-submission abuse of the trial quota. */
    if (!req.is('application/json')) {
      return res.status(415).json({ message: 'Content-Type must be application/json' });
    }

    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_GUEST_TEXT_LENGTH) {
      return res.status(400).json({ message: 'Invalid message text' });
    }

    const tenantId = req.user?.tenantId || getTenantId();
    const appConfig = await getAppConfig(tenantId ? { tenantId } : { baseOnly: true });

    if (!isGuestChatEnabled(appConfig.guestChat)) {
      return res.status(404).json({ message: 'Guest chat is not enabled' });
    }

    const { guestId } = getOrCreateGuestId(req, res);

    const usage = await incrementGuestUsage({
      guestId,
      limit: appConfig.guestChat.messageLimit ?? 1,
      expiresAt: getGuestUsageExpiresAt(),
    });

    if (!usage) {
      return res.status(403).json({ code: 'guest_login_required' });
    }

    const replyText = await runGuestChat({
      req,
      appConfig,
      provider: appConfig.guestChat.provider,
      model: appConfig.guestChat.model,
      instructions: appConfig.guestChat.instructions,
      model_parameters: appConfig.guestChat.model_parameters,
      text: text.trim(),
    });

    return res.status(200).json({ text: replyText });
  } catch (error) {
    logger.error('[guest/chat] Failed to process guest chat request', error);
    return res.status(500).json({ message: 'Something went wrong' });
  }
});

module.exports = router;
