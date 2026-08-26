import { Router } from 'express';
import { authenticate, requireAdmin, requireVerified } from '../middleware/auth.js';
import {
  deleteVerificationRequest,
  deletePasswordResetRequest,
  getVerificationRequests,
  approvePasswordResetRequest,
  verifyClientRequest,
} from '../controllers/verificationRequestController.js';

const router = Router();

router.use(authenticate, requireVerified, requireAdmin);
router.get('/', getVerificationRequests);
router.post('/:id/verify', verifyClientRequest);
router.delete('/:id', deleteVerificationRequest);
router.post('/password-resets/:id/approve', approvePasswordResetRequest);
router.delete('/password-resets/:id', deletePasswordResetRequest);

export default router;
