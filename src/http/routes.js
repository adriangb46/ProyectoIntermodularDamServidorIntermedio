import { Router } from 'express';
import { loginController } from './auth-controller.js';

export const httpRouter = Router();

// Ruta pública de Login
httpRouter.post('/login', loginController);

// Aquí se pueden añadir más rutas HTTP si fueran necesarias en el futuro,
// aunque la arquitectura dicta que el resto de comunicación será vía WebSockets.
