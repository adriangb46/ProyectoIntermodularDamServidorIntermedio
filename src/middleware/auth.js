import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

/**
 * Middleware para validar el JWT en conexiones de Socket.IO.
 * Se usa interceptando la conexión: io.use(socketAuthMiddleware)
 * 
 * @param {import('socket.io').Socket} socket 
 * @param {Function} next 
 */
export const socketAuthMiddleware = (socket, next) => {
  // 1. Extraer el token (Soporte para auth.token o headers.authorization)
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization;

  if (!token) {
    return next(new Error('Autenticación fallida: Token no proporcionado'));
  }

  try {
    // 2. Limpiar el prefijo 'Bearer ' si viene incluido
    const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
    
    // 3. Validar la firma criptográfica usando el secreto centralizado
    const decoded = jwt.verify(cleanToken, config.jwtSecret);
    
    // 4. Inyectar los datos del usuario en el socket.
    // El personaje activo se resolverá más tarde cuando el usuario lo seleccione.
    socket.user = {
      username: decoded.sub,  // Nombre de usuario (campo estándar JWT)
      role: decoded.role,     // Rol del usuario (USER | ADMIN)
    };

    // 5. Token válido, dejar pasar la conexión
    next();
  } catch (err) {
    // El token expiró o la firma es inválida
    return next(new Error('Autenticación fallida: Token inválido o expirado'));
  }
};
