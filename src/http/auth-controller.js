import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { dbConnector } from '../connectors/db-connector.js';
import crypto from 'crypto';

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
      console.warn(`[Taquilla] Login fallido: Credenciales denegadas para ${username}.`);
      return res.status(401).json({ message: "Usuario o contraseña inválidos" });
    }

    // Asegurarse de tener el rol, si el backend aún no lo expone lo forzamos a 'USER' temporalmente
    const role = dbResponse.role || 'USER';

    // 2. Fabricar el JWT siguiendo el estándar RFC 7519
    // El token identifica al usuario (sub) y su rol. Los personajes/clanes
    // se gestionan como estado de juego, no como estado de sesión.
    const token = jwt.sign(
      {
        sub: dbResponse.username, // Sujeto estándar JWT — nombre de usuario
        role: dbResponse.role,    // Rol del usuario (USER | ADMIN)
        jti: crypto.randomUUID()  // Identificador único de JWT (security.md §2)
      },
      config.jwtSecret,
      { expiresIn: '2h' } // Duración corta por seguridad
    );

    console.log(`[Taquilla] Login exitoso: ${username} autenticado. Emisión de JWT completada.`);

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
      console.warn(`[Taquilla] Registro fallido para ${username}: ${err.message}`);
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
        sub: dbResponse.username,
        role: dbResponse.role,
        jti: crypto.randomUUID()
      },
      config.jwtSecret,
      { expiresIn: '2h' }
    );

    console.log(`[Taquilla] Registro exitoso: ${username} creado. Emisión de JWT completada.`);

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
    const { redisConnector } = await import('../connectors/redis-connector.js');
    await redisConnector.blacklist(jti, ttlSeconds);

    console.log(`[Taquilla] Logout exitoso para JTI: ${jti}. Token invalidado en Redis.`);

    return res.status(200).json({ message: "Sesión cerrada correctamente" });
  } catch (error) {
    next(error);
  }
};
