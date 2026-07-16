const rateLimit = require('express-rate-limit');
const { limiterCache, removePorts } = require('@librechat/api');

const { GUEST_CHAT_IP_MAX = 20, GUEST_CHAT_IP_WINDOW = 1 } = process.env;

const windowMs = GUEST_CHAT_IP_WINDOW * 60 * 1000;

/**
 * IP rate limiter dedicated to the unauthenticated guest chat endpoint.
 *
 * Not a reuse of `messageIpLimiter`: that limiter's handler calls
 * `denyRequest`, which unconditionally reads `req.user.id` and throws for
 * anonymous requests. This is a second line of defense against an IP
 * repeatedly clearing its guest cookie to mint fresh trial messages — the
 * `GuestUsage` per-guestId counter is the primary limit.
 */
const guestChatIpLimiter = rateLimit({
  windowMs,
  max: GUEST_CHAT_IP_MAX,
  keyGenerator: removePorts,
  store: limiterCache('guest_chat_ip_limiter'),
  handler: (_req, res) => {
    res.status(429).json({ message: 'Too many requests, please try again later.' });
  },
});

module.exports = { guestChatIpLimiter };
