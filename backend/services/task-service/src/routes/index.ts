// Task service root router — mounts all task routes under /tasks prefix
import { Router } from 'express';
import { taskRouter } from './task.routes';

export const rootRouter = Router();

// All task service routes are under /tasks in app.ts
rootRouter.use('/', taskRouter);
