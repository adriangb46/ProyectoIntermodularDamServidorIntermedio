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
  dbServerUrl: process.env.DB_SERVER_URL || 'http://localhost:8080',
  dbHandshakeToken: process.env.DB_HANDSHAKE_SECRET || process.env.DB_HANDSHAKE_TOKEN,

  // --- Configuración del Time Wheel ---
  timeWheelTickMs: Number(process.env.TIME_WHEEL_TICK_MS) || 500,
  postgresDumpIntervalMs: Number(process.env.POSTGRES_DUMP_INTERVAL_MS) || 900_000,
  mongoDbDumpIntervalMs: Number(process.env.MONGODB_DUMP_INTERVAL_MS) || 7_200_000,

  // --- Fases de la partida ---
  // Duración de la fase de preparación antes de que comience la guerra (5 min por defecto)
  preparationDurationMs: Number(process.env.PREPARATION_DURATION_MS) || 300_000,

  // --- Recursos iniciales de los jugadores ---
  maxEconomicCredits: Number(process.env.MAX_ECONOMIC_CREDITS) || 1000,
  maxResearchCredits: Number(process.env.MAX_RESEARCH_CREDITS) || 10000,
  initialResearchCredits: Number(process.env.INITIAL_RESEARCH_CREDITS) || 500,

  // Tiempo de viaje fijo de las tropas atacantes (10 s por defecto)
  troopTravelTimeMs: Number(process.env.TROOP_TRAVEL_TIME_MS) || 10_000,

  // --- Configuración de Redis ---
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  // --- Mecánicas de Juego (Equilibrio) ---
  defaultCapitalHealth: Number(process.env.DEFAULT_CAPITAL_HEALTH) || 3000,
  
  // Combate
  typeAdvantageMultiplier: Number(process.env.TYPE_ADVANTAGE_MULTIPLIER) || 1.5,
  capitalDefenseBonus: Number(process.env.CAPITAL_DEFENSE_BONUS) || 1.1,
  researchCreditsRate: Number(process.env.RESEARCH_CREDITS_RATE) || 1,

  // Generación de Recursos (Tick)
  warResourcePercentage: Number(process.env.WAR_RESOURCE_PERCENTAGE) || 20,
  warResourceIntervalMinMs: Number(process.env.WAR_RESOURCE_INTERVAL_MIN_MS) || 30_000,
  warResourceIntervalMaxMs: Number(process.env.WAR_RESOURCE_INTERVAL_MAX_MS) || 60_000,
  
  endResourcePercentage: Number(process.env.END_RESOURCE_PERCENTAGE) || 15,
  endResourceIntervalMs: Number(process.env.END_RESOURCE_INTERVAL_MS) || 20_000,

  // --- Configuración de MinIO (S3) ---
  minioEndpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
  minioAccessKey: process.env.MINIO_ACCESS_KEY,
  minioSecretKey: process.env.MINIO_SECRET_KEY,
  minioBucketAvatars: process.env.MINIO_BUCKET_AVATARS || 'avatars',
  minioPublicBaseUrl: process.env.MINIO_PUBLIC_BASE_URL || 'http://localhost:9000/avatars',
  
  // --- Rate Limiting ---
  rateLimitLoginWindowMs: Number(process.env.RATE_LIMIT_LOGIN_WINDOW_MS) || 900_000, // 15 min
  rateLimitLoginMax: Number(process.env.RATE_LIMIT_LOGIN_MAX) || 20,
  rateLimitRegisterWindowMs: Number(process.env.RATE_LIMIT_REGISTER_WINDOW_MS) || 3_600_000, // 60 min
  rateLimitRegisterMax: Number(process.env.RATE_LIMIT_REGISTER_MAX) || 10,
  rateLimitJoinGameWindowMs: Number(process.env.RATE_LIMIT_JOIN_GAME_WINDOW_MS) || 60_000, // 1 min
  rateLimitJoinGameMax: Number(process.env.RATE_LIMIT_JOIN_GAME_MAX) || 40,
});

// Importación diferida para evitar ciclos y asegurar que dotenv esté listo
import('../utils/logger.js').then(({ logger }) => {
  logger.info('⚙️  Cargando configuración del sistema...');
  logger.debug({
    cwd: process.cwd(),
    jwtPresent: !!config.jwtSecret,
    dbHandshakePresent: !!config.dbHandshakeToken
  }, '[Config] Estado de variables críticas');

  if (!config.jwtSecret || !config.dbHandshakeToken || !config.dbServerUrl) {
    const missing = [];
    if (!config.jwtSecret) missing.push('JWT_SECRET');
    if (!config.dbHandshakeToken) missing.push('DB_HANDSHAKE_SECRET/TOKEN');
    if (!config.dbServerUrl) missing.push('DB_SERVER_URL');

    logger.error({ missing }, '🛑 ERROR DE CONFIGURACIÓN: Faltan variables críticas');
    
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
});
