import { Router } from 'express';
import { authenticate, authenticateForPasswordChange } from '../middleware/auth.js';
import {
  register,
  verifyPhone,
  resendCode,
  login,
  getMe,
  forgotPassword,
  resetPassword,
  changePassword,
  getRegistrationStatus,
  completeTemporaryPassword,
} from '../controllers/authController.js';

const router = Router();

router.post('/register', register);
router.post('/verify', verifyPhone);
router.post('/resend-code', resendCode);
router.post('/registration-status', getRegistrationStatus);
router.post('/login', login);

router.get('/me', authenticateForPasswordChange, getMe);
router.patch('/me/password', authenticate, changePassword);
router.post(
  '/complete-temporary-password',
  authenticateForPasswordChange,
  completeTemporaryPassword
);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

export default router;
