import { Request, Response, NextFunction } from "express";

interface ErrorResponseObject {
  error: {
    message: string;
    statusCode: number;
    code?: string; // Optional code property
  };
}

/**
 * Central error handler middleware for standardized error responses
 */
const handleErrors = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error("ERROR:", err.name, "-", err.message);
  // console.error(err.stack); // Uncomment for detailed stack trace during dev

  let statusCode = err.statusCode || 500;
  let message = err.message || "An unexpected internal server error occurred.";
  let errorCode = err.errorCode; // Optional custom error code

  // Handle specific error types if needed
  if (err.name === "ValidationError") {
    // Example for a validation library
    statusCode = 400;
    message = err.details || err.message; // Joi or express-validator might have different structures
  } else if (err.name === "UnauthorizedError") {
    // Example for JWT errors
    statusCode = 401;
    message = "Invalid or missing authentication token.";
  } else if (err.code === "23505") {
    // Postgres unique violation
    statusCode = 409; // Conflict
    message = "A record with the provided details already exists.";
    // You might want to parse err.detail to provide a more specific message.
  }

  const errorResponse: ErrorResponseObject = {
    error: {
      message: message,
      statusCode: statusCode,
    },
  };
  if (errorCode) {
    errorResponse.error.code = errorCode;
  }

  res.status(statusCode).json(errorResponse);
};

export default { handleErrors };
