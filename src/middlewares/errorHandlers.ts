import { NextFunction, Request, Response } from 'express';

export interface AppError extends Error {
  status?: number;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction,
) => {
  // log the error to the console for debugging purposes
  console.log(err);

  res.status(err.status || 500).json({
    message: err.message || 'Internal Server Error',
    status: err.status || 500,
  });
};
