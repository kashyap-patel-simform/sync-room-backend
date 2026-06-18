import { Request, Response } from 'express';

export interface AppError extends Error {
  staus?: number;
}

export const errorHandler = (err: AppError, req: Request, res: Response) => {
  // log the error to the console for debugging purposes
  console.log(err);

  res.status(err.staus || 500).json({
    message: err.message || 'Internal Server Error',
    status: err.staus || 500,
  });
};
