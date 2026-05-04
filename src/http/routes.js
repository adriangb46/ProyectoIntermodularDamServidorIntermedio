import { Router } from 'express';
import multer from 'multer';
import { loginController, registerController, logoutController } from './auth-controller.js';
import { avatarUploadController } from './avatar-controller.js';
import { getGameAvailabilityController, getMyGamesController, createGameController } from './games-controller.js';
import { httpAuthMiddleware } from '../middleware/auth.js';
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

// Gestión de Partidas
httpRouter.get('/games/my-games', httpAuthMiddleware, getMyGamesController);
httpRouter.post('/games', httpAuthMiddleware, createGameController);

// Aquí se pueden añadir más rutas HTTP si fueran necesarias en el futuro,
// aunque la arquitectura dicta que el resto de comunicación será vía WebSockets.
