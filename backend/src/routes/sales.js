import { Router } from 'express';
import { authenticate, requireVerified, requireAdmin } from '../middleware/auth.js';
import { getMySaleLogs, getSaleLogs, refundSale, sellTariff, updateSale } from '../controllers/saleController.js';

const router = Router();

router.get('/my', authenticate, requireVerified, getMySaleLogs);
router.post('/', authenticate, requireVerified, requireAdmin, sellTariff);
router.get('/', authenticate, requireVerified, requireAdmin, getSaleLogs);
router.patch('/:id', authenticate, requireVerified, requireAdmin, updateSale);
router.post('/:id/refund', authenticate, requireVerified, requireAdmin, refundSale);

export default router;
