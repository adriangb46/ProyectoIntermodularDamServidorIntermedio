import { dbConnector } from '../db/db-connector.js';
import { logger } from '../utils/logger.js';

/**
 * Controlador de Perfil (HTTP REST)
 * Gestiona operaciones relacionadas con la cuenta del usuario actual.
 */

export const getProfileController = async (req, res, next) => {
  try {
    const userId = req.user.userId; // Extraído del JWT por el middleware
    
    // Obtenemos el usuario del DB Server
    const response = await dbConnector.getUser(userId);
    const user = response?.data || response;

    // Solo enviamos lo necesario al frontend (security.md §8)
    return res.status(200).json({
      email: user.email,
      username: user.username,
      avatarUrl: user.avatarUrl
    });
  } catch (error) {
    if (error.status === 404) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }
    next(error);
  }
};

export const changePasswordController = async (req, res, next) => {
  try {
    const userId = req.user.userId; // Security.md §5: ID del JWT, nunca del body
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "La contraseña actual y la nueva son requeridas" });
    }

    await dbConnector.changePassword(userId, currentPassword, newPassword);
    
    logger.info({ userId }, '[Profile] Contraseña actualizada exitosamente.');
    return res.status(204).send();

  } catch (error) {
    // Si el DB server responde 401, reenviamos 401
    if (error.status === 401) {
      logger.warn({ userId: req.user?.sub }, '[Profile] Intento de cambio de contraseña con contraseña actual incorrecta.');
      return res.status(401).json({ message: "La contraseña actual es incorrecta" });
    }
    next(error);
  }
};

export const updateEmailController = async (req, res, next) => {
  try {
    const userId = req.user.userId; // Security.md §5
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "El nuevo email es requerido" });
    }

    await dbConnector.updateEmail(userId, email);

    logger.info({ userId }, '[Profile] Email actualizado exitosamente.');
    return res.status(204).send();

  } catch (error) {
    // Si el DB server responde 409 (Conflicto), reenviamos 409
    if (error.status === 409) {
      logger.warn({ userId: req.user?.sub, email: req.body?.email }, '[Profile] Intento de cambio de email a uno ya existente.');
      return res.status(409).json({ message: "El email ya está registrado" });
    }
    next(error);
  }
};
