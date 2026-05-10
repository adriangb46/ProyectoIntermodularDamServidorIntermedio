import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { redisConnector } from '../db/redis-connector.js';

/**
 * Middleware para validar el JWT en conexiones de Socket.IO.
 * Se usa interceptando la conexión: io.use(socketAuthMiddleware)
 * 
 * @param {import('socket.io').Socket} socket 
 * @param {Function} next 
 */
export const socketAuthMiddleware = async (socket, next) => {
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
    
    // 4. Verificar si el JTI está en la lista negra (Redis)
    const blacklisted = await redisConnector.isBlacklisted(decoded.jti);
    if (blacklisted) {
      return next(new Error('Autenticación fallida: Token revocado (sesión cerrada)'));
    }

    // 5. Verificar si el usuario está baneado
    const isBanned = await redisConnector.client.sIsMember('banned_users', decoded.sub);
    if (isBanned) {
      return next(new Error('Autenticación fallida: Usuario baneado'));
    }

    // 5. Inyectar los datos del usuario en el socket.
    socket.user = {
      userId: decoded.sub,    // UUID del usuario
      username: decoded.username, // Nombre de usuario
      role: decoded.role,     // Rol del usuario (USER | ADMIN)
      jti: decoded.jti        // ID único del token
    };

    // 6. Token válido, dejar pasar la conexión
    next();
  } catch (err) {
    // El token expiró o la firma es inválida
    return next(new Error('Autenticación fallida: Token inválido o expirado'));
  }
};

/**
 * Middleware para validar el JWT en peticiones HTTP (Express).
 * 
 * @param {import('express').Request} req 
 * @param {import('express').Response} res 
 * @param {import('express').NextFunction} next 
 */
export const httpAuthMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ message: "No autorizado: Token no proporcionado" });
  }

  try {
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    const decoded = jwt.verify(token, config.jwtSecret);

    // Verificar lista negra
    const blacklisted = await redisConnector.isBlacklisted(decoded.jti);
    if (blacklisted) {
      return res.status(401).json({ message: "No autorizado: Token revocado" });
    }

    // Verificar si el usuario está baneado
    const isBanned = await redisConnector.client.sIsMember('banned_users', decoded.sub);
    if (isBanned) {
      return res.status(403).json({ message: "Prohibido: Usuario baneado" });
    }

    // Inyectar usuario en la request
    req.user = {
      userId: decoded.sub,
      username: decoded.username,
      role: decoded.role,
      jti: decoded.jti,
      exp: decoded.exp
    };

    next();
  } catch (err) {
    return res.status(401).json({ message: "No autorizado: Token inválido o expirado" });
  }
};

/**
 * Middleware para restringir el acceso según el rol.
 * 
 * @param {string} requiredRole 
 */
export const roleMiddleware = (requiredRole) => {
  return (req, res, next) => {
    if (!req.user || req.user.role !== requiredRole) {
      return res.status(403).json({ message: "Prohibido: No tienes permisos suficientes" });
    }
    next();
  };
};
