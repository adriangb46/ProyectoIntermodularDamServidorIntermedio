import { Router } from 'express';
import multer from 'multer';
import { loginController, registerController, logoutController } from './auth-controller.js';
import { avatarUploadController, avatarUpdateUrlController } from './avatar-controller.js';
import { getGameAvailabilityController } from './games-controller.js';
import { getProfileController, changePasswordController, updateEmailController } from './profile-controller.js';
import { getAdminStatsController, listUsersController, banUserController, unbanUserController } from './admin-controller.js';
import { getUserStatsController } from './stats-controller.js';
import { httpAuthMiddleware, roleMiddleware } from '../middleware/auth.js';
import { loginLimiter, registerLimiter } from '../middleware/rate-limiter.js';

export const httpRouter = Router();

// Configuración de multer para subida de avatares en memoria
// Límite de 5 MB (security.md §9)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
    files: 1,                   // Solo un archivo por petición
  },
});

// Rutas públicas (con rate limiting — security.md §3)
httpRouter.post('/login', loginLimiter, loginController);
httpRouter.post('/register', registerLimiter, registerController);
httpRouter.get('/games/:code/availability', getGameAvailabilityController);

// Rutas protegidas
httpRouter.post('/logout', httpAuthMiddleware, logoutController);
httpRouter.post('/avatar', httpAuthMiddleware, upload.single('avatar'), avatarUploadController);
httpRouter.put('/avatar/url', httpAuthMiddleware, avatarUpdateUrlController);
httpRouter.get('/profile', httpAuthMiddleware, getProfileController);
httpRouter.put('/profile/password', httpAuthMiddleware, changePasswordController);
httpRouter.put('/profile/email', httpAuthMiddleware, updateEmailController);
httpRouter.get('/profile/stats', httpAuthMiddleware, getUserStatsController);

// Rutas de administración (solo para ADMIN)
httpRouter.get('/admin/stats', httpAuthMiddleware, roleMiddleware('ADMIN'), getAdminStatsController);
httpRouter.get('/admin/users', httpAuthMiddleware, roleMiddleware('ADMIN'), listUsersController);
httpRouter.put('/admin/users/:id/ban', httpAuthMiddleware, roleMiddleware('ADMIN'), banUserController);
httpRouter.put('/admin/users/:id/unban', httpAuthMiddleware, roleMiddleware('ADMIN'), unbanUserController);

// Aquí se pueden añadir más rutas HTTP si fueran necesarias en el futuro,
// aunque la arquitectura dicta que el resto de comunicación será vía WebSockets.
