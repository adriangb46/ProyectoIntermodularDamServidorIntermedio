import dotenv from 'dotenv';

// Cargamos el .env intentando varias rutas relativas comunes
dotenv.config({ path: '.env' });          // En middle_server/
dotenv.config({ path: '../.env' });       // En tfm/ si se lanza desde src/
dotenv.config({ path: '../../.env' });    // En tfm/ si se lanza desde middle_server/
dotenv.config({ path: '../../../.env' }); // En tfm/ si se lanza desde middle_server/src/

/**
 * Objeto de configuración centralizado e inmutable.
 * Previene el uso esparcido de process.env por todo el código.
 */
export const config = Object.freeze({
  port: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET,
  dbServerUrl: process.env.DB_SERVER_URL,
  dbHandshakeToken: process.env.DB_HANDSHAKE_TOKEN,

  // --- Configuración del Time Wheel ---
  // Intervalo de tick del bucle principal (ms). Default: 500ms
  timeWheelTickMs: Number(process.env.TIME_WHEEL_TICK_MS) || 500,

  // Intervalo de volcado a PostgreSQL (ms). Default: 15 min
  postgresDumpIntervalMs: Number(process.env.POSTGRES_DUMP_INTERVAL_MS) || 900_000,

  // Intervalo de volcado a MongoDB/Analíticas (ms). Default: 2 horas
  mongoDbDumpIntervalMs: Number(process.env.MONGODB_DUMP_INTERVAL_MS) || 7_200_000,

  // --- Configuración de Redis ---
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
});

// Validación temprana (Fail Fast): Si falta un secreto crítico, avisamos inmediatamente.
if (!config.jwtSecret) {
  console.warn('⚠️ ADVERTENCIA CRÍTICA: No se ha detectado JWT_SECRET en las variables de entorno.');
}
