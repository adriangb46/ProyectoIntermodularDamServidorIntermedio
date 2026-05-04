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
  dotenv.config({ path: envPath, override: true });
}

/**
 * Objeto de configuración centralizado e inmutable.
 * Previene el uso esparcido de process.env por todo el código.
 */
export const config = Object.freeze({
  port: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET || process.env.MIDDLE_JWT_SECRET,
  dbServerUrl: process.env.DB_SERVER_URL,
  dbHandshakeToken: process.env.DB_HANDSHAKE_SECRET || process.env.DB_HANDSHAKE_TOKEN,

  // --- Configuración del Time Wheel ---
  timeWheelTickMs: Number(process.env.TIME_WHEEL_TICK_MS) || 500,
  postgresDumpIntervalMs: Number(process.env.POSTGRES_DUMP_INTERVAL_MS) || 900_000,
  mongoDbDumpIntervalMs: Number(process.env.MONGODB_DUMP_INTERVAL_MS) || 7_200_000,

  // --- Configuración de Redis ---
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
});

console.log('⚙️  Cargando configuración del sistema...');
console.log(`   - CWD: ${process.cwd()}`);
console.log(`   - JWT_SECRET: ${config.jwtSecret ? '✅ Presente' : '❌ AUSENTE'}`);
console.log(`   - DB_HANDSHAKE: ${config.dbHandshakeToken ? '✅ Presente' : '❌ AUSENTE'}`);

if (!config.jwtSecret || !config.dbHandshakeToken || !config.dbServerUrl) {
  const missing = [];
  if (!config.jwtSecret) missing.push('JWT_SECRET');
  if (!config.dbHandshakeToken) missing.push('DB_HANDSHAKE_SECRET/TOKEN');
  if (!config.dbServerUrl) missing.push('DB_SERVER_URL');

  console.error(`🛑 ERROR DE CONFIGURACIÓN: Faltan variables críticas: ${missing.join(', ')}`);
  console.error('El servidor no puede continuar sin estas variables.');
  // En producción, salimos. En desarrollo, podríamos dejarlo pasar pero aquí forzamos seguridad.
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}
