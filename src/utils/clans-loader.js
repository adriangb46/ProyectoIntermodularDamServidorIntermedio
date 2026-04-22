import fs from 'node:fs/promises';

/**
 * Cargador de la configuración estática de los clanes.
 * Centraliza el acceso a las estadísticas de tropas, costes y árboles de investigación.
 */
class ClansLoader {
  constructor() {
    this.data = null;
  }

  /**
   * Carga el archivo de configuración de clanes.
   * Por defecto busca clans.json en la raíz del servidor intermedio.
   * @param {string} filePath - Ruta al archivo de configuración.
   */
  async init(filePath = './clans.json') {
    try {
      const rawData = await fs.readFile(filePath, 'utf-8');
      this.data = JSON.parse(rawData);
    } catch (error) {
      // Si el archivo no existe, lanzamos un error claro ya que es crítico para el motor
      throw new Error(`No se pudo cargar la configuración de clanes desde ${filePath}: ${error.message}`);
    }
  }

  /**
   * Retorna la configuración completa de un clan específico.
   * @param {string} clanId 
   */
  getClan(clanId) {
    return this.data?.clans?.[clanId];
  }

  /**
   * Retorna las estadísticas base de un tipo de tropa.
   * @param {string} clanId 
   * @param {string} troopTypeId 
   */
  getTroopStats(clanId, troopTypeId) {
    return this.data?.clans?.[clanId]?.troops?.[troopTypeId];
  }

  /**
   * Retorna el árbol de investigación de un clan.
   * @param {string} clanId 
   */
  getResearchTree(clanId) {
    return this.data?.clans?.[clanId]?.researches;
  }

  /**
   * Lista todos los IDs de clanes disponibles.
   * @returns {string[]}
   */
  getAvailableClans() {
    return Object.keys(this.data?.clans || {});
  }
}

// Exportamos una instancia única
export const clansLoader = new ClansLoader();
