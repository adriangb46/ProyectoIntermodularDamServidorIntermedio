import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { config } from './src/config/index.js';
import { httpRouter } from './src/http/routes.js';
import { socketAuthMiddleware } from './src/middleware/auth.js';
import { initSocketHandler } from './src/connectors/socket-handler.js';
import { TimeWheel } from './src/game/engine/time-wheel.js';
import { gameStore } from './src/game/state/game-store.js';
import { dbConnector } from './src/connectors/db-connector.js';

// 1. Inicialización de Express (Servidor HTTP)
const app = express();

// Seguridad Básica y Middlewares
app.disable('x-powered-by');
app.use(express.json());
app.use(cors({
  origin: '*', // TODO: Restringir al dominio del frontend en producción
  methods: ['GET', 'POST']
}));

// Rutas HTTP
app.use('/api', httpRouter);

// Manejador de errores global de Express
app.use((err, req, res, next) => {
  console.error('[HTTP Error]', err.stack);
  res.status(500).json({ message: "Error interno del servidor" });
});

// 2. Inicialización del Servidor y WebSockets
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*', // TODO: Restringir al dominio del frontend
    methods: ['GET', 'POST']
  }
});

// 3. Conectar el Middleware de Seguridad a Socket.IO
io.use(socketAuthMiddleware);

// 4. Iniciar Manejadores de Socket.IO
initSocketHandler(io);

// 5. Arrancar el Time Wheel y el Servidor
async function startServer() {
  try {
    console.log('🔄 Iniciando handshake con DB Server...');
    await dbConnector.performHandshake();

    // IMPORTANTE: se inicializa después de io para poder pasarle la referencia
    const timeWheel = new TimeWheel(gameStore, io, config);
    timeWheel.start();

    // Arrancar el servidor HTTP
    httpServer.listen(config.port, () => {
      console.log(`🛡️ Middle Server corriendo en el puerto ${config.port}`);
      console.log(`🚀 Rutas HTTP mapeadas bajo /api`);
      console.log(`⚡ WebSockets listos y asegurados por JWT`);
      console.log(`⏱️  Time Wheel activo (tick cada ${config.timeWheelTickMs}ms)`);
    });
  } catch (error) {
    console.error('❌ Error crítico durante el arranque del Middle Server:', error.message);
    process.exit(1);
  }
}

startServer();