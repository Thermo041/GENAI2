import { errors } from '../utils/errors.js';

/**
 * Zod-based request validation. Replaces req.body/query/params with the parsed
 * (and coerced) values so controllers never see raw user input.
 */
export function validate({ body, query, params }) {
  return (req, _res, next) => {
    try {
      if (params) req.params = params.parse(req.params);
      if (query) req.validatedQuery = query.parse(req.query);
      if (body) req.body = body.parse(req.body ?? {});
      return next();
    } catch (err) {
      if (err?.issues) {
        const details = err.issues.slice(0, 8).map((issue) => ({
          field: issue.path.join('.') || 'body',
          message: issue.message,
        }));
        return next(errors.validation(details[0] ? `${details[0].field}: ${details[0].message}` : 'Invalid request.', details));
      }
      return next(err);
    }
  };
}
