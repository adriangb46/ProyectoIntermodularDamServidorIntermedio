import dotenv from 'dotenv';

// Cargamos el .env de la raíz del proyecto (un nivel por encima de middle_server)
// Nota: en Docker/Producción esto se puede ignorar si las variables ya están en el entorno
dotenv.config({ path: '../.env' });

/**
 * Objeto de configuración centralizado e inmutable.
 * Previene el uso esparcido de process.env por todo el código.
 */
export const config = Object.freeze({
  port: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET,
  dbServerUrl: process.env.DB_SERVER_URL,
  dbHandshakeToken: process.env.DB_HANDSHAKE_TOKEN,
});

// Validación temprana (Fail Fast): Si falta un secreto crítico, avisamos inmediatamente.
if (!config.jwtSecret) {
  console.warn('⚠️ ADVERTENCIA CRÍTICA: No se ha detectado JWT_SECRET en las variables de entorno.');
}
