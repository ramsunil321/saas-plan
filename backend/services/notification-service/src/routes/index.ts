// Central route aggregator — mounted in app.ts
import { Router } from 'express';
import notificationRoutes from './notification.routes';

const router = Router();

router.use('/notifications', notificationRoutes);

export default router;
