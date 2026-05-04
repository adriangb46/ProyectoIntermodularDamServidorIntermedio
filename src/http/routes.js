import { Router } from 'express';
import { loginController, registerController, logoutController } from './auth-controller.js';
import { httpAuthMiddleware } from '../middleware/auth.js';

export const httpRouter = Router();

// Rutas públicas
httpRouter.post('/login', loginController);
httpRouter.post('/register', registerController);

// Rutas protegidas
httpRouter.post('/logout', httpAuthMiddleware, logoutController);

// Aquí se pueden añadir más rutas HTTP si fueran necesarias en el futuro,
// aunque la arquitectura dicta que el resto de comunicación será vía WebSockets.
