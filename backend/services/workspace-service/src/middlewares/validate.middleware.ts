// Zod validation middleware factory — identical to auth-service.
// See auth-service/src/middlewares/validate.middleware.ts for full docs.
import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';

export const validate = (schema: AnyZodObject) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const validated = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      if (validated.body) req.body = validated.body;
      if (validated.query) req.query = validated.query;
      if (validated.params) req.params = validated.params;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
        res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details } });
        return;
      }
      next(error);
    }
  };
};
