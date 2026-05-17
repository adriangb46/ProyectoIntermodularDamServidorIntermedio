import { dbConnector } from '../db/db-connector.js';
import { redisConnector } from '../db/redis-connector.js';
import os from 'os';
import { gameStore } from '../game/state/game-store.js';
import { logger } from '../utils/logger.js';

// --- Cálculo preciso y ultra-ligero de la carga de CPU en segundo plano ---
let lastCpuInfo = getCpuTicks();
let currentCpuUsage = 0;

function getCpuTicks() {
  const cpus = os.cpus() || [];
  let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
  for (const cpu of cpus) {
    user += cpu.times.user;
    nice += cpu.times.nice;
    sys += cpu.times.sys;
    idle += cpu.times.idle;
    irq += cpu.times.irq;
  }
  const total = user + nice + sys + idle + irq;
  return { idle, total };
}

// Se ejecuta cada 3 segundos midiendo la diferencia real de ticks de CPU
const cpuInterval = setInterval(() => {
  try {
    const currentTicks = getCpuTicks();
    const idleDifference = currentTicks.idle - lastCpuInfo.idle;
    const totalDifference = currentTicks.total - lastCpuInfo.total;
    
    if (totalDifference > 0) {
      const percentage = 100 - Math.round((idleDifference / totalDifference) * 100);
      currentCpuUsage = Math.max(0, Math.min(100, percentage));
    }
    lastCpuInfo = currentTicks;
  } catch (err) {
    // Evitar cualquier crash inesperado del sistema de archivos o lectura de cpus
  }
}, 3000);

// Permite que Node.js termine de forma limpia en los tests de integración sin quedar bloqueado
if (typeof cpuInterval.unref === 'function') {
  cpuInterval.unref();
}

/**
 * Obtiene estadísticas consolidadas para el Panel de Administrador.
 * Combina datos persistentes de la DB con métricas en tiempo real del Middle.
 * 
 * @param {import('express').Request} req 
 * @param {import('express').Response} res 
 */
export const getAdminStatsController = async (req, res) => {
  try {
    // 1. Obtener estadísticas persistentes del DB Server
    let dbStats = { totalUsers: 0, totalGames: 0, bannedUsers: 0 };
    try {
      const response = await dbConnector.getAdminStats();
      dbStats = response?.data || response || dbStats;
    } catch (err) {
      logger.error({ err: err.message }, '[Admin] Error al obtener estadísticas del DB Server');
      // Continuamos con valores por defecto para no bloquear el panel entero
    }

    // 2. Obtener métricas en tiempo real de la memoria del Middle Server
    const io = req.app.get('io');
    let activeUsers = 0;
    if (io) {
      if (io.sockets && io.sockets.sockets) {
        activeUsers = io.sockets.sockets.size; // Conexiones Socket.IO activas directas (v4)
      } else if (io.engine && typeof io.engine.clientsCount === 'number') {
        activeUsers = io.engine.clientsCount; // Fallback
      }
    }
    const activeGames = gameStore.getAll().length;
    const finishedGamesLastHour = gameStore.countFinishedGamesInLastHour();

    // 3. Obtener métricas del sistema (Carga del servidor)
    // Retornamos el valor pre-calculado en background de forma instantánea O(1)
    const serverLoad = currentCpuUsage;

    const stats = {
      // De DB Server
      totalUsers: dbStats.totalUsers || 0,
      totalGames: dbStats.totalGames || 0,
      bannedUsers: dbStats.bannedUsers || 0,
      // De Middle Server (Memoria)
      activeUsers,
      activeGames,
      finishedGamesLastHour,
      serverLoad
    };

    return res.json({
      status: 'success',
      data: stats
    });
  } catch (err) {
    logger.error({ err: err.message }, '[Admin] Fallo crítico en getAdminStatsController');
    return res.status(500).json({
      status: 'error',
      message: 'Fallo al recuperar estadísticas de administración'
    });
  }
};

/**
 * Lista todos los usuarios (proxy a DB Server).
 */
export const listUsersController = async (req, res) => {
  try {
    const response = await dbConnector.getAllUsers();
    const users = response?.data || response || [];
    res.json(users);
  } catch (error) {
    logger.error({ err: error.message }, '[Admin] Error al listar usuarios');
    res.status(500).json({ message: 'Error al listar usuarios' });
  }
};

/**
 * Banea a un usuario (proxy a DB Server).
 */
export const banUserController = async (req, res) => {
  try {
    const { id } = req.params;
    await dbConnector.banUser(id);

    // 1. Añadir a la lista de baneados en Redis (TTL 2 horas para cubrir expiración de JWTs)
    // Usamos el ID del usuario como clave en el set de baneados
    await redisConnector.client.sAdd('banned_users', id);
    await redisConnector.client.expire('banned_users', 7200); // 2h

    // 2. Localizar y desconectar sockets del usuario
    const io = req.app.get('io');
    if (io) {
      const sockets = await io.fetchSockets();
      for (const socket of sockets) {
        if (socket.user?.userId === id) {
          logger.info({ userId: id, socketId: socket.id }, '[Admin] Desconectando socket de usuario baneado');
          socket.emit('user:banned', { message: 'Has sido baneado del sistema' });
          socket.disconnect(true);
        }
      }
    }

    res.status(204).send();
  } catch (error) {
    logger.error({ err: error.message, userId: req.params.id }, '[Admin] Error al banear usuario');
    res.status(500).json({ message: 'Error al banear usuario' });
  }
};

/**
 * Desbanea a un usuario (proxy a DB Server).
 */
export const unbanUserController = async (req, res) => {
  try {
    const { id } = req.params;
    await dbConnector.unbanUser(id);
    res.status(204).send();
  } catch (error) {
    logger.error({ err: error.message, userId: req.params.id }, '[Admin] Error al desbanear usuario');
    res.status(500).json({ message: 'Error al desbanear usuario' });
  }
};
