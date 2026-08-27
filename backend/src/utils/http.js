/** Consistent success envelope: { success: true, data }. */
export function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

/** Consistent error envelope: { success: false, error: { code, message, details? } }. */
export function fail(res, { code, message, details }, status = 400) {
  const body = { success: false, error: { code, message } };
  if (details !== undefined) body.error.details = details;
  return res.status(status).json(body);
}

/** Wraps async route handlers so rejections reach the central error handler. */
export function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
