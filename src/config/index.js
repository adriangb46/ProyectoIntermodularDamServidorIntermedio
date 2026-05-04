import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Intentamos cargar el .env desde varias ubicaciones posibles, priorizando la raíz del proyecto
const envPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../../../.env'),
  '.env'
];

for (const envPath of envPaths) {
  dotenv.config({ path: envPath });
}

/**
 * Objeto de configuración centralizado e inmutable.
 * Previene el uso esparcido de process.env por todo el código.
 */
export const config = Object.freeze({
  port: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET,
  dbServerUrl: process.env.DB_SERVER_URL,
  dbHandshakeToken: process.env.DB_HANDSHAKE_SECRET || process.env.DB_HANDSHAKE_TOKEN,

  // --- Configuración del Time Wheel ---
  timeWheelTickMs: Number(process.env.TIME_WHEEL_TICK_MS) || 500,
  postgresDumpIntervalMs: Number(process.env.POSTGRES_DUMP_INTERVAL_MS) || 900_000,
  mongoDbDumpIntervalMs: Number(process.env.MONGODB_DUMP_INTERVAL_MS) || 7_200_000,

  // --- Configuración de Redis ---
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
});

// Validación temprana (Fail Fast)
const missingKeys = [];
if (!config.jwtSecret) missingKeys.push('JWT_SECRET');
if (!config.dbHandshakeToken) missingKeys.push('DB_HANDSHAKE_SECRET/TOKEN');
if (!config.dbServerUrl) missingKeys.push('DB_SERVER_URL');

if (missingKeys.length > 0) {
  console.warn(`⚠️ CONFIGURACIÓN INCOMPLETA: Faltan las siguientes variables: ${missingKeys.join(', ')}`);
  console.log('💡 Tip: Asegúrate de que el archivo .env existe en la raíz del proyecto o las variables están seteadas.');
}
