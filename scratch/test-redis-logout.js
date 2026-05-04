import jwt from 'jsonwebtoken';
import { redisConnector } from '../src/connectors/redis-connector.js';
import { config } from '../src/config/index.js';
import crypto from 'crypto';

async function testLogout() {
  console.log('--- Iniciando prueba de Logout con Redis ---');

  const jti = crypto.randomUUID();
  const payload = {
    sub: 'testuser',
    role: 'USER',
    jti: jti
  };

  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: '1h' });
  const decoded = jwt.decode(token);
  const exp = decoded.exp;

  console.log(`1. Token generado con JTI: ${jti}`);

  try {
    // Verificar que no está en la lista negra
    const isInitiallyBlacklisted = await redisConnector.isBlacklisted(jti);
    console.log(`2. ¿Está en lista negra inicialmente?: ${isInitiallyBlacklisted}`);

    // Blacklist el token
    const nowSeconds = Math.floor(Date.now() / 1000);
    const ttlSeconds = exp - nowSeconds;
    
    console.log(`3. Añadiendo a lista negra con TTL: ${ttlSeconds}s...`);
    await redisConnector.blacklist(jti, ttlSeconds);

    // Verificar que ahora está en la lista negra
    const isNowBlacklisted = await redisConnector.isBlacklisted(jti);
    console.log(`4. ¿Está en lista negra después de logout?: ${isNowBlacklisted}`);

    if (isNowBlacklisted === true) {
      console.log('✅ PRUEBA EXITOSA: El token ha sido invalidado correctamente en Redis.');
    } else {
      console.error('❌ PRUEBA FALLIDA: El token no aparece en la lista negra.');
    }

  } catch (error) {
    console.error('❌ Error durante la prueba:', error);
  } finally {
    // Cerrar conexión para que el script termine
    await redisConnector.client.quit();
  }
}

testLogout();
