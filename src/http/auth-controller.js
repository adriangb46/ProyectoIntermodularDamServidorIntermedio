import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
// Importaremos el dbConnector cuando Dev B lo implemente
// import { dbConnector } from '../connectors/db-connector.js';

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
    // Cuando Dev B lo implemente, esto será:
    // const dbResponse = await dbConnector.verifyCredentials(username, password);

    // -- TODO: Eliminar este mock cuando el dbConnector esté listo --
    console.log(`[Taquilla] Verificando credenciales en DB Server para: ${username}`);
    const isMockValid = username === 'admin' && password === '1234'; // MOCK
    if (!isMockValid) {
      // Regla de seguridad: mensaje genérico para no revelar qué campo falla
      return res.status(401).json({ message: "Usuario o contraseña inválidos" });
    }
    const dbResponse = { username, role: 'USER' }; // MOCK — Dev B aportará el rol real
    // ---------------------------------------------------------------

    // 2. Fabricar el JWT siguiendo el estándar RFC 7519
    // El token identifica al usuario (sub) y su rol. Los personajes/clanes
    // se gestionan como estado de juego, no como estado de sesión.
    const token = jwt.sign(
      {
        sub: dbResponse.username, // Sujeto estándar JWT — nombre de usuario
        role: dbResponse.role,    // Rol del usuario (USER | ADMIN)
      },
      config.jwtSecret,
      { expiresIn: '2h' } // Duración corta por seguridad
    );

    // 3. Devolver el token al frontend
    return res.status(200).json({ token });

  } catch (error) {
    // Pasar el error al manejador global de Express
    next(error);
  }
};
