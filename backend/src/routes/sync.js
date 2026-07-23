import { Router } from 'express';
import { authenticate, requireVerified, requireAdmin } from '../middleware/auth.js';
import { syncStatus } from '../controllers/syncController.js';

const router = Router();
router.get('/status', authenticate, requireVerified, requireAdmin, syncStatus);
export default router;
