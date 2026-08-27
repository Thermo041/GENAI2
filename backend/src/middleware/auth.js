import { User } from '../models/User.js';
import { errors } from '../utils/errors.js';
import { asyncHandler } from '../utils/http.js';

/** Loads the session user onto req.user (no throw — public routes still work). */
export const attachUser = asyncHandler(async (req, _res, next) => {
  const userId = req.session?.userId;
  if (!userId) return next();
  const user = await User.findById(userId);
  if (!user) {
    req.session.destroy(() => {});
    return next();
  }
  req.user = user;
  req.log?.setBindings?.({ userId: user._id.toString(), login: user.login });
  return next();
});

/** Hard gate for everything that touches private data or writes. */
export function requireAuth(req, _res, next) {
  if (!req.user) return next(errors.unauthorized());
  return next();
}

/** Used by webhook routes: they authenticate by signature, not session. */
export function noSession(req, _res, next) {
  req.user = undefined;
  return next();
}
