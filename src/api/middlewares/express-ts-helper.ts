/**
 * Express 4 does not forward rejected promises from async handlers: an
 * uncaught throw leaves the request hanging. Wrap every async route handler.
 */

import { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wraps an async request handler so a thrown/rejected error reaches next()
 * and therefore the global errorHandler.
 */
export const asyncHandler = <Req extends Request = Request>(
  handler: (req: Req, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler => {
  return (req, res, next) => {
    handler(req as Req, res, next).catch(next);
  };
};

/** @deprecated alias of asyncHandler; kept so existing imports compile. */
export const protectedAsyncHandler = asyncHandler;
