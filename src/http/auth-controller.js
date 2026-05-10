import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { dbConnector } from '../db/db-connector.js';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';

/**
 * Controlador de Login (HTTP REST) — "La Taquilla"
 * Recibe las credenciales del Frontend, las verifica contra el DB Server,
 * y si son correctas, expide el JWT de sesión.
 *
 * El JWT identifica al USUARIO (sub, role). Los datos de personaje y clan
 * son estado de juego y se resuelven en el flujo posterior vía WebSocket.
 */
export const loginController = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: "Usuario y contraseña son requeridos" });
    }

    // 1. Llamada REST al DB Server (Spring Boot)
    let dbResponse;
    try {
      // Retorna ApiResponse<UserResponseDto>, dbConnector.fetchWithAuth ya hace el unwrap parcial o podemos asumir que dbConnector devuelve el objeto parseado.
      // fetchWithAuth devuelve el JSON completo. Si el DB Server envuelve en { data: ... }, lo extraemos.
      const rawResponse = await dbConnector.verifyCredentials(username, password);
      dbResponse = rawResponse?.data || rawResponse;
    } catch (err) {
      if (err.status === 403) {
        logger.warn({ username }, '[Taquilla] Login denegado: Usuario baneado.');
        return res.status(403).json({ message: "BANNED_USER" });
      }
      logger.warn({ username }, '[Taquilla] Login fallido: Credenciales denegadas.');
      return res.status(401).json({ message: "Usuario o contraseña inválidos" });
    }

    // Asegurarse de tener el rol, si el backend aún no lo expone lo forzamos a 'USER' temporalmente
    const role = dbResponse.role || 'USER';

    // 2. Fabricar el JWT siguiendo el estándar RFC 7519
    // El token identifica al usuario (sub) y su rol. Los personajes/clanes
    // se gestionan como estado de juego, no como estado de sesión.
    const token = jwt.sign(
      {
        sub: dbResponse.id,       // UUID del usuario (Sujeto estándar JWT)
        username: dbResponse.username, // Nombre de usuario para el Frontend
        role: dbResponse.role,    // Rol del usuario (USER | ADMIN)
        jti: crypto.randomUUID()  // Identificador único de JWT (security.md §2)
      },
      config.jwtSecret,
      { expiresIn: '2h' } // Duración corta por seguridad
    );

    logger.info({ username }, '[Taquilla] Login exitoso. Emisión de JWT completada.');

    // 3. Devolver el token al frontend
    return res.status(200).json({ token });

  } catch (error) {
    // Pasar el error al manejador global de Express
    next(error);
  }
};

/**
 * Controlador de Registro (HTTP REST)
 * Recibe los datos de registro del Frontend y los pasará al DB Server.
 * Devuelve un JWT de sesión al igual que el login.
 */
export const registerController = async (req, res, next) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ message: "Usuario, email y contraseña son requeridos" });
    }

    // 1. Llamada REST al DB Server (Spring Boot)
    let dbResponse;
    try {
      const rawResponse = await dbConnector.createUser({ username, email, password });
      dbResponse = rawResponse?.data || rawResponse;
    } catch (err) {
      logger.warn({ username, err: err.message }, '[Taquilla] Registro fallido');
      // Si es un 409 Conflict o similar
      if (err.status === 409) {
        return res.status(409).json({ message: err.message });
      }
      return res.status(400).json({ message: "Datos de registro inválidos" });
    }

    const role = dbResponse.role || 'USER';

    // 2. Fabricar el JWT
    const token = jwt.sign(
      {
        sub: dbResponse.id,
        username: dbResponse.username,
        role: dbResponse.role,
        jti: crypto.randomUUID()
      },
      config.jwtSecret,
      { expiresIn: '2h' }
    );

    logger.info({ username }, '[Taquilla] Registro exitoso. Emisión de JWT completada.');

    // 3. Devolver el token al frontend
    return res.status(201).json({ token });

  } catch (error) {
    next(error);
  }
};

/**
 * Controlador de Logout (HTTP REST)
 * Invalida el token actual añadiendo su JTI a la lista negra de Redis.
 */
export const logoutController = async (req, res, next) => {
  try {
    const { jti, exp } = req.user;

    // Calcular cuánto tiempo le queda al token para expirar (en segundos)
    const nowSeconds = Math.floor(Date.now() / 1000);
    const ttlSeconds = Math.max(exp - nowSeconds, 0);

    // Añadir a la lista negra en Redis
    const { redisConnector } = await import('../db/redis-connector.js');
    await redisConnector.blacklist(jti, ttlSeconds);

    logger.info({ jti }, '[Taquilla] Logout exitoso. Token invalidado en Redis.');

    return res.status(200).json({ message: "Sesión cerrada correctamente" });
  } catch (error) {
    next(error);
  }
};
