import crypto from 'crypto';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { minioConnector } from '../connectors/minio-connector.js';
import { dbConnector } from '../connectors/db-connector.js';

// Tipos MIME aceptados validados por magic bytes (security.md §9)
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

// Tamaño máximo de archivo (5 MB como dicta security.md §9)
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Controlador de subida de avatar (HTTP REST).
 * Flujo completo: validar magic bytes → redimensionar con sharp → subir a MinIO → persistir URL en PostgreSQL.
 *
 * Cumple con security.md §9:
 * - Validación de tipo por magic bytes (no solo Content-Type header)
 * - Redimensionado a 200×200 px (stripea EXIF malicioso)
 * - Nombre de archivo aleatorio (UUID)
 * - Credenciales de MinIO nunca expuestas al frontend
 */
export const avatarUploadController = async (req, res, next) => {
  try {
    // 1. Verificar que se proporcionó un archivo
    if (!req.file) {
      return res.status(400).json({ message: 'No se proporcionó ningún archivo de imagen' });
    }

    // 2. Verificar tamaño (multer ya lo limita, pero doble comprobación defensiva)
    if (req.file.size > MAX_FILE_SIZE_BYTES) {
      return res.status(413).json({ message: 'El archivo excede el tamaño máximo permitido (5 MB)' });
    }

    // 3. Validar tipo real por magic bytes (NO confiar en Content-Type del cliente)
    const fileTypeResult = await fileTypeFromBuffer(req.file.buffer);
    if (!fileTypeResult || !ALLOWED_MIME_TYPES.has(fileTypeResult.mime)) {
      const detectedType = fileTypeResult?.mime || 'desconocido';
      console.warn(`[Avatar] Tipo de archivo rechazado: ${detectedType} para usuario ${req.user.username}`);
      return res.status(400).json({
        message: 'Tipo de archivo no permitido. Solo se aceptan imágenes JPEG, PNG y WebP',
      });
    }

    // 4. Redimensionar a 200×200 px en formato WebP con sharp
    //    sharp también elimina metadatos EXIF potencialmente maliciosos
    const processedBuffer = await sharp(req.file.buffer)
      .resize(200, 200, {
        fit: 'cover',        // Recorta manteniendo la relación de aspecto
        position: 'centre',  // Centra el recorte
      })
      .webp({ quality: 80 }) // Formato de salida WebP optimizado
      .toBuffer();

    // 5. Generar nombre de archivo aleatorio (UUID — security.md §9)
    const avatarUuid = crypto.randomUUID();

    // 6. Subir a MinIO
    const avatarUrl = await minioConnector.uploadAvatar(processedBuffer, avatarUuid);

    // 7. Obtener el ID del usuario desde el DB Server para persistir la URL
    //    El JWT contiene 'sub' (username), necesitamos el UUID del usuario
    let userResponse;
    try {
      const rawResponse = await dbConnector.getUserByUsername(req.user.username);
      userResponse = rawResponse?.data || rawResponse;
    } catch (err) {
      console.error(`[Avatar] Error al obtener usuario ${req.user.username}: ${err.message}`);
      return res.status(500).json({ message: 'Error al procesar la solicitud de avatar' });
    }

    // 8. Persistir la URL del avatar en PostgreSQL via DB Server
    try {
      await dbConnector.updateAvatar(userResponse.id, avatarUrl);
    } catch (err) {
      console.error(`[Avatar] Error al persistir URL de avatar para ${req.user.username}: ${err.message}`);
      return res.status(500).json({ message: 'Error al guardar el avatar' });
    }

    console.log(`[Avatar] Avatar actualizado para ${req.user.username}: ${avatarUrl}`);

    // 9. Devolver la URL pública al frontend (el cliente la carga directamente desde MinIO)
    return res.status(200).json({ avatarUrl });

  } catch (error) {
    next(error);
  }
};
