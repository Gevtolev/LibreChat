const { logger } = require('@librechat/data-schemas');
const { generate2FATempToken } = require('~/server/services/twoFactorService');
const { setAuthTokens } = require('~/server/services/AuthService');
const {
  getPriorAnonymousUserId,
  migrateAnonymousData,
} = require('~/server/services/anonymousAccount');

const loginController = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    if (req.user.twoFactorEnabled) {
      const tempToken = generate2FATempToken(req.user._id);
      return res.status(200).json({ twoFAPending: true, tempToken });
    }

    const { password: _p, totpSecret: _t, __v, ...user } = req.user;
    user.id = user._id.toString();

    const token = await setAuthTokens(req.user._id, res, null, req);

    /**
     * Logging into a pre-existing account while still holding an anonymous session's token
     * (rather than registering, which upgrades that same account in place) means the visitor
     * had a different real account all along — fold the anonymous trial's data into it.
     */
    const priorAnonymousUserId = await getPriorAnonymousUserId(req);
    if (priorAnonymousUserId && priorAnonymousUserId !== user.id) {
      await migrateAnonymousData(priorAnonymousUserId, req.user._id);
    }

    return res.status(200).send({ token, user });
  } catch (err) {
    logger.error('[loginController]', err);
    return res.status(500).json({ message: 'Something went wrong' });
  }
};

module.exports = {
  loginController,
};
