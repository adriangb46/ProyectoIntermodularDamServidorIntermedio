import { gameData } from '../../config/game-data-loader.js';

/**
 * Módulo puro para calcular los multiplicadores activos de un jugador
 * según sus investigaciones desbloqueadas.
 *
 * Este módulo no tiene efectos secundarios: dada la misma entrada, siempre
 * devuelve el mismo resultado. Es testeable de forma aislada.
 *
 * Los multiplicadores se acumulan de forma MULTIPLICATIVA (no sumando),
 * para reflejar rendimientos decrecientes realistas.
 */

/**
 * Calcula los multiplicadores totales para un jugador según su árbol
 * tecnológico desbloqueado.
 *
 * @param {string[]} unlockedResearches - Lista de IDs de investigaciones completadas.
 * @param {string} clanId - ID del clan del jugador (ej: 'berserkers').
 * @returns {{ attackMultiplier: number, defenseMultiplier: number, healthMultiplier: number, speedMultiplier: number, capitalHealthMultiplier: number, capitalDefenseMultiplier: number, incomeMultiplier: number }}
 */
export function getResearchMultipliers(unlockedResearches, clanId) {
  // Valores base: sin buffs activos
  const multipliers = {
    attackMultiplier: 1.0,
    defenseMultiplier: 1.0,
    healthMultiplier: 1.0,
    speedMultiplier: 1.0,
    capitalHealthMultiplier: 1.0,
    capitalDefenseMultiplier: 1.0,
    incomeMultiplier: 1.0,
  };

  if (!unlockedResearches || unlockedResearches.length === 0) {
    return multipliers;
  }

  const clan = gameData[clanId];
  if (!clan || !clan.technologies) return multipliers;

  // Recorrer las investigaciones desbloqueadas del jugador
  for (const researchId of unlockedResearches) {
    const tech = clan.technologies.find(t => t.id === researchId);
    if (!tech || !tech.unlocks?.buffs) continue;

    for (const buff of tech.unlocks.buffs) {
      const m = buff.multiplier ?? 1.0;

      // Acumulación multiplicativa por categoría
      if (buff.target === 'troops') {
        if (buff.attribute === 'attack')  multipliers.attackMultiplier  *= m;
        if (buff.attribute === 'defense') multipliers.defenseMultiplier *= m;
        if (buff.attribute === 'health')  multipliers.healthMultiplier  *= m;
        if (buff.attribute === 'speed')   multipliers.speedMultiplier   *= m;
      }

      if (buff.target === 'capital') {
        if (buff.attribute === 'health')  multipliers.capitalHealthMultiplier  *= m;
        if (buff.attribute === 'defense') multipliers.capitalDefenseMultiplier *= m;
        if (buff.attribute === 'attack')  multipliers.attackMultiplier         *= m;
      }

      if (buff.target === 'economy') {
        if (buff.attribute === 'income') multipliers.incomeMultiplier *= m;
      }
    }
  }

  return multipliers;
}

/**
 * Calcula el daño final de un atacante aplicando sus buffs de ataque.
 * @param {number} rawDamage - Daño base calculado (suma de currentPoints de tropas).
 * @param {string[]} unlockedResearches - Investigaciones desbloqueadas del atacante.
 * @param {string} clanId - Clan del atacante.
 * @returns {number} Daño final con multiplicadores aplicados.
 */
export function applyAttackBuffs(rawDamage, unlockedResearches, clanId) {
  const { attackMultiplier } = getResearchMultipliers(unlockedResearches, clanId);
  return rawDamage * attackMultiplier;
}
