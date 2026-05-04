import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Carga y valida los datos de los clanes desde el archivo clans.yml.
 * @returns {Object} Datos de los clanes.
 */
function loadGameData() {
  const yamlPath = path.join(__dirname, '../../clans.yml');
  
  try {
    const fileContents = fs.readFileSync(yamlPath, 'utf8');
    const data = yaml.load(fileContents);
    
    if (!data || !data.clans) {
      throw new Error('Estructura de clans.yml inválida: falta la sección "clans"');
    }
    
    // Convertir el array de clanes en un objeto indexado por ID para acceso rápido
    const clansMap = {};
    data.clans.forEach(clan => {
      clansMap[clan.id] = clan;
    });
    
    console.log(`[GameData] Cargados ${data.clans.length} clanes desde clans.yml`);
    return Object.freeze(clansMap);
  } catch (error) {
    console.error(`[GameData] Error al cargar clans.yml: ${error.message}`);
    // En un entorno real, esto debería detener el servidor (Fail-Fast)
    throw error;
  }
}

export const gameData = loadGameData();
