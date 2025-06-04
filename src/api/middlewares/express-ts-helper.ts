/**
 * This file contains type helpers for Express to make TypeScript and Express route handlers
 * work well together, especially with async functions.
 */

import { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wraps an async request handler to catch and propagate errors to next()
 * @param handler The async request handler to wrap
 */
export const asyncHandler = (handler: Function): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    // @ts-ignore - Suppressing TypeScript errors for return values
    Promise.resolve(handler(req, res, next)).catch(next);
  };
};

/**
 * A specialized version of asyncHandler that helps with TypeScript compatibility
 * for routes that use the AuthenticatedRequest interface
 */
export const protectedAsyncHandler = (handler: Function): RequestHandler => {
  return asyncHandler(handler);
};
