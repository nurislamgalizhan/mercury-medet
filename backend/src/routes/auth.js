import { Router } from 'express';
import { authenticate, authenticateForPasswordChange } from '../middleware/auth.js';
import {
  register,
  login,
  adminMfaVerify,
  adminMfaResend,
  getMe,
  forgotPassword,
  changePassword,
  getRegistrationStatus,
  completeTemporaryPassword,
} from '../controllers/authController.js';

const router = Router();

router.post('/register', register);
router.post('/registration-status', getRegistrationStatus);
router.post('/login', login);
router.post('/admin-mfa/verify', adminMfaVerify);
router.post('/admin-mfa/resend', adminMfaResend);

router.get('/me', authenticateForPasswordChange, getMe);
router.patch('/me/password', authenticate, changePassword);
router.post(
  '/complete-temporary-password',
  authenticateForPasswordChange,
  completeTemporaryPassword
);
router.post('/forgot-password', forgotPassword);

export default router;
