const { logger } = require('@librechat/data-schemas');

/**
 * Resolves the anonymous session that was active on this browser *before* the current
 * register/login request, via the `refreshToken` cookie (sent automatically by the browser on
 * both an XHR login and a full-page OAuth redirect — unlike a custom Authorization header,
 * which OAuth's browser-navigated callback never carries). Returns the underlying user id only
 * if that account is still a live, unclaimed anonymous placeholder; `null` for anything else —
 * no cookie, no matching session, or a real (non-anonymous) account.
 */
async function getPriorAnonymousUserId(req) {
  const refreshToken = req?.cookies?.refreshToken;
  if (!refreshToken) {
    return null;
  }

  const { findSession } = require('~/models');
  let session;
  try {
    session = await findSession({ refreshToken });
  } catch {
    return null;
  }
  if (!session?.user) {
    return null;
  }

  const { User } = require('~/db/models');
  const user = await User.findById(session.user).select('provider').lean();
  if (!user || user.provider !== 'anonymous') {
    return null;
  }

  return String(session.user);
}

/**
 * Reassigns an anonymous account's conversations/messages/files to the account the visitor
 * just logged into, then deletes the now-empty anonymous placeholder. No-op (and logs a
 * warning) if the source account isn't a live anonymous placeholder anymore — guards against
 * a stale/replayed anonymous token re-triggering a migration that already happened.
 */
async function migrateAnonymousData(anonymousUserId, targetUserId) {
  const { User, Conversation, Message, File } = require('~/db/models');

  const anonymousUser = await User.findById(anonymousUserId).select('provider').lean();
  if (!anonymousUser || anonymousUser.provider !== 'anonymous') {
    logger.warn(
      `[migrateAnonymousData] Skipped — ${anonymousUserId} is no longer a live anonymous account`,
    );
    return;
  }

  await Promise.all([
    Conversation.updateMany({ user: anonymousUserId }, { $set: { user: targetUserId } }),
    Message.updateMany({ user: anonymousUserId }, { $set: { user: targetUserId } }),
    File.updateMany({ user: anonymousUserId }, { $set: { user: targetUserId } }),
  ]);

  await User.deleteOne({ _id: anonymousUserId });
}

module.exports = {
  getPriorAnonymousUserId,
  migrateAnonymousData,
};
