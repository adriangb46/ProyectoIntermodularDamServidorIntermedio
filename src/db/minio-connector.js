import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * Conector singleton para MinIO (compatible con API S3).
 * Gestiona la subida de avatares de usuario al almacenamiento de objetos.
 * Las credenciales de MinIO nunca se exponen al frontend (security.md §9).
 */
class MinioConnector {
  constructor() {
    // Extraemos host y puerto de la URL de MinIO para configurar el cliente S3
    const endpointUrl = new URL(config.minioEndpoint);

    this.client = new S3Client({
      region: 'us-east-1', // MinIO ignora la región, pero el SDK la exige
      endpoint: config.minioEndpoint,
      forcePathStyle: true, // Necesario para MinIO (no usa subdominios virtuales)
      credentials: {
        accessKeyId: config.minioAccessKey,
        secretAccessKey: config.minioSecretKey,
      },
    });

    this.bucket = config.minioBucketAvatars;
    this.publicBaseUrl = config.minioPublicBaseUrl;
  }

  /**
   * Sube un avatar procesado al bucket de MinIO.
   * @param {Buffer} buffer - Imagen ya redimensionada (200x200 webp)
   * @param {string} uuid - Nombre único del archivo (sin extensión)
   * @returns {Promise<string>} URL pública del avatar subido
   */
  async uploadAvatar(buffer, uuid) {
    const key = `${uuid}.webp`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: 'image/webp',
    });

    await this.client.send(command);
    logger.info({ key }, '[MinIO] Avatar subido correctamente');

    return this.getAvatarUrl(uuid);
  }

  /**
   * Construye la URL pública de un avatar.
   * El bucket es public-read, así que el cliente puede acceder directamente sin autenticación.
   * @param {string} uuid - Identificador del avatar
   * @returns {string} URL pública
   */
  getAvatarUrl(uuid) {
    // Eliminamos trailing slash de la base URL si existe
    const base = this.publicBaseUrl.replace(/\/+$/, '');
    return `${base}/${uuid}.webp`;
  }
}

// Exportamos como singleton
export const minioConnector = new MinioConnector();
