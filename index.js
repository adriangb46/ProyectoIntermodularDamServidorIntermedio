import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { config } from './src/config/index.js';
import { httpRouter } from './src/http/routes.js';
import { socketAuthMiddleware } from './src/middleware/auth.js';
import { initSocketHandler } from './src/socket/socket-handler.js';
import { TimeWheel } from './src/game/engine/time-wheel.js';
import { gameStore } from './src/game/state/game-store.js';
import { gameData } from './src/config/game-data-loader.js';
import { dbConnector } from './src/db/db-connector.js';
import { syncManager } from './src/game/state/sync-manager.js';
import { logger } from './src/utils/logger.js';

// 1. Inicialización de Express (Servidor HTTP)
const app = express();

// Seguridad Básica y Middlewares
app.disable('x-powered-by');
app.use(express.json());
app.use(cors({
  origin: '*', // TODO: Restringir al dominio del frontend en producción
  methods: ['GET', 'POST']
}));

// Logger de Diagnóstico en Producción (Sanitizado)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    // Sanitizar body para logs (no imprimir secretos — security.md §3)
    const sensitiveFields = ['password', 'currentPassword', 'newPassword', 'secret', 'token'];
    const sanitizedBody = req.body ? { ...req.body } : {};
    
    sensitiveFields.forEach(field => {
      if (sanitizedBody[field]) sanitizedBody[field] = '[REDACTED]';
    });
    
    logger.info({
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      query: Object.keys(req.query).length > 0 ? req.query : undefined,
      body: Object.keys(sanitizedBody).length > 0 ? sanitizedBody : undefined
    }, '[HTTP] Request processed');
  });
  next();
});

// Rutas HTTP
app.use('/api', httpRouter);

// Manejador de errores global de Express
app.use((err, req, res, next) => {
  const status = err.status || 500;
  
  if (status === 500) {
    logger.error({ err: err.stack }, '[HTTP Error 500]');
  } else {
    logger.warn({ status, msg: err.message }, '[HTTP Error]');
  }

  res.status(status).json({ 
    message: status === 500 ? "Error interno del servidor" : err.message,
    status
  });
});

// 2. Inicialización del Servidor y WebSockets
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*', // TODO: Restringir al dominio del frontend
    methods: ['GET', 'POST']
  }
});

// Compartir la instancia de io con Express para acceder desde controladores HTTP
app.set('io', io);

// 3. Conectar el Middleware de Seguridad a Socket.IO
io.use(socketAuthMiddleware);

// 4. Iniciar Manejadores de Socket.IO
// IMPORTANTE: se inicializa después de io para poder pasarle la referencia
const timeWheel = new TimeWheel(gameStore, io, config);
initSocketHandler(io, timeWheel);

// 5. Arrancar el Time Wheel y el Servidor
async function startServer() {
  try {
    logger.info('[Startup] Iniciando handshake con DB Server...');
    await dbConnector.performHandshake();

    // Sincronización Inicial de Partidas
    await syncManager.loadActiveGames();

    timeWheel.start();

    // Los volcados periódicos ahora se programan automáticamente en el TimeWheel
    // al cargar o crear cada partida (ver TimeWheel._processTick).

    // Arrancar el servidor HTTP
    httpServer.listen(config.port, () => {
      logger.info({ port: config.port }, '🛡️ Middle Server corriendo');
      logger.debug('🚀 Rutas HTTP mapeadas bajo /api');
      logger.debug('⚡ WebSockets listos y asegurados por JWT');
      logger.debug({ tickMs: config.timeWheelTickMs }, '⏱️  Time Wheel activo');
    });
  } catch (error) {
    logger.error({ err: error.message }, '❌ Error crítico durante el arranque');
    process.exit(1);
  }
}

startServer();