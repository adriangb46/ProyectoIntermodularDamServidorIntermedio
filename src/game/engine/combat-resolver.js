/**
 * Módulo de resolución de combate — "Guerra Total".
 *
 * Reglas implementadas (ver .agents/combat_rules.md):
 *   - Multiplicador de ventaja de tipo: 1.5x sobre el daño del atacante.
 *   - Bono de defensa en capital: 1.1x sobre el poder del defensor.
 *   - Las tropas defensoras absorben el daño antes de que llegue a la capital.
 *   - El daño sobrante (overflow) reduce directamente la salud de la capital.
 *   - Si la capital llega a 0, el defensor queda eliminado.
 *   - Las tropas atacantes supervivientes regresan a su capital de origen.
 *   - Los créditos de investigación se otorgan al atacante en proporción al daño infligido.
 *
 * Este módulo es PURO: no genera efectos secundarios de Socket.IO ni de persistencia.
 * Toda la comunicación y persistencia la gestiona el llamador (time-wheel.js).
 */

import { config } from '../../config/index.js';

/** Multiplicador de daño cuando el atacante tiene ventaja de tipo sobre el defensor. */
const TYPE_ADVANTAGE_MULTIPLIER = config.typeAdvantageMultiplier;

/** Bono de defensa aplicado al poder del defensor por defender su propia capital. */
const CAPITAL_DEFENSE_BONUS = config.capitalDefenseBonus;

/**
 * Porcentaje del daño total infligido al defensor que se convierte en créditos
 * de investigación para el atacante.
 */
const RESEARCH_CREDITS_RATE = config.researchCreditsRate;

// =============================================================================
// Función pública
// =============================================================================

/**
 * Resuelve una batalla entre un atacante y un defensor.
 *
 * Implementa la mecánica de "resta simultánea": el daño del atacante y el del
 * defensor se calculan a partir del estado inicial del combate y se aplican al
 * mismo tiempo, de modo que ningún bando recibe ventaja por "atacar primero".
 *
 * @param {import('../../models/player').Player} attacker
 *   Jugador que inicia el ataque.
 * @param {import('../../models/player').Player} defender
 *   Jugador propietario de la capital objetivo.
 * @param {import('../../models/troop').Troop[]} attackingTroops
 *   Array de instancias Troop que participan en el ataque (deployed === true).
 * @param {Object} gameData
 *   Mapa de datos de clanes cargado de clans.yml, indexado por clanId.
 *   Cada entrada contiene al menos { archetype, advantages }.
 * @returns {{
 *   attackerSurvivors:       import('../../models/troop').Troop[],
 *   defenderTroopsDestroyed: import('../../models/troop').Troop[],
 *   attackerTroopsLost:      import('../../models/troop').Troop[],
 *   capitalDamage:           number,
 *   researchCreditsEarned:   number,
 *   defenderEliminated:      boolean,
 *   typeMultiplier:          number,
 *   finalAttackPower:        number,
 *   finalDefensePower:       number
 * }}
 */
export function resolveBattle(attacker, defender, attackingTroops, gameData) {
  // --- 1. Obtener arquetipos y calcular multiplicador de tipo ---
  const attackerClan = gameData[attacker.clanId];
  const defenderClan = gameData[defender.clanId];
  const typeMultiplier = _getTypeMultiplier(attackerClan, defenderClan);

  // --- 2. Poder de ataque bruto ---
  const rawAttackPower = attackingTroops.reduce((sum, t) => sum + t.currentPoints, 0);
  const finalAttackPower = Math.round(rawAttackPower * typeMultiplier);

  // --- 3. Poder de defensa bruto (solo tropas en capital, no las desplegadas) ---
  const defendingTroops = defender.getDefendingTroops();
  const rawDefensePower = defendingTroops.reduce((sum, t) => sum + t.currentPoints, 0);
  const finalDefensePower = Math.round(rawDefensePower * CAPITAL_DEFENSE_BONUS);

  // --- 4. Aplicar daño al defensor (simultáneo: se calcula sobre el estado inicial) ---
  const { capitalDamage: actualCapitalDamage, troopsDestroyed: defenderTroopsDestroyed, totalTroopDamage: defenderTroopsDamage } =
    _applyDamageToDefender(defendingTroops, defender, finalAttackPower);

  // --- 5. Aplicar daño de retorno al atacante (simultáneo) ---
  const { troopsDestroyed: attackerTroopsLost } =
    _applyDamageToAttacker(attackingTroops, finalDefensePower);

  // --- 6. Limpiar tropas muertas de ambos bandos ---
  defender.cleanupDeadTroops();
  attacker.cleanupDeadTroops();

  // --- 7. Tropas atacantes supervivientes (tras la limpieza) ---
  const attackerSurvivors = attackingTroops.filter(t => t.currentPoints > 0);

  // --- 8. Créditos de investigación ganados por el atacante ---
  //   Se calculan sobre el daño efectivamente infligido al defensor (War Weariness)
  const totalDamageDealt = defenderTroopsDamage + actualCapitalDamage;
  const researchCreditsEarned = Math.floor(totalDamageDealt * RESEARCH_CREDITS_RATE);

  // --- 9. Comprobar si el defensor ha sido eliminado ---
  const defenderEliminated = defender.capitalHealth <= 0;
  if (defenderEliminated) {
    defender.eliminated = true;
  }

  return {
    attackerSurvivors,
    defenderTroopsDestroyed,
    attackerTroopsLost,
    capitalDamage: actualCapitalDamage,
    researchCreditsEarned,
    defenderEliminated,
    typeMultiplier,
    finalAttackPower,
    finalDefensePower,
    totalDamageDealt,
  };
}

// =============================================================================
// Funciones privadas
// =============================================================================

/**
 * Determina el multiplicador de tipo en función de las ventajas del atacante
 * frente al arquetipo del defensor.
 *
 * @param {{ archetype: string, advantages: string[] }} attackerClan
 * @param {{ archetype: string }} defenderClan
 * @returns {number} 1.5 si hay ventaja, 1.0 si no.
 */
function _getTypeMultiplier(attackerClan, defenderClan) {
  if (!attackerClan || !defenderClan) {
    // Datos de clan desconocidos: sin multiplicador (seguro por defecto)
    return 1.0;
  }

  const hasAdvantage =
    Array.isArray(attackerClan.advantages) &&
    attackerClan.advantages.includes(defenderClan.archetype);

  return hasAdvantage ? TYPE_ADVANTAGE_MULTIPLIER : 1.0;
}

/**
 * Aplica el daño del atacante al defensor.
 * Las tropas defensoras absorben el daño en orden; el daño sobrante (overflow)
 * se resta directamente de la salud de la capital del defensor.
 *
 * @param {import('../../models/troop').Troop[]} defendingTroops
 *   Tropas en capital al inicio del combate (snapshot del estado inicial).
 * @param {import('../../models/player').Player} defender
 * @param {number} damageAmount - Daño total que inflige el atacante.
 * @returns {{ capitalDamage: number, troopsDestroyed: import('../../models/troop').Troop[], totalTroopDamage: number }}
 */
function _applyDamageToDefender(defendingTroops, defender, damageAmount) {
  let remainingDamage = damageAmount;
  const troopsDestroyed = [];
  let totalTroopDamage = 0;

  for (const troop of defendingTroops) {
    if (remainingDamage <= 0) break;
    const damageToThisTroop = Math.min(troop.currentPoints, remainingDamage);
    totalTroopDamage += damageToThisTroop;
    remainingDamage = troop.takeDamage(remainingDamage);
    if (troop.isDead()) {
      troopsDestroyed.push(troop);
    }
  }

  // Daño sobrante tras eliminar todas las tropas → impacta en la capital
  const rawCapitalDamage = remainingDamage > 0 ? remainingDamage : 0;
  let actualCapitalDamage = 0;
  
  if (rawCapitalDamage > 0) {
    actualCapitalDamage = Math.min(defender.capitalHealth, rawCapitalDamage);
    defender.capitalHealth = Math.max(0, defender.capitalHealth - actualCapitalDamage);
  }

  return { capitalDamage: actualCapitalDamage, troopsDestroyed, totalTroopDamage };
}

/**
 * Aplica el daño de retorno del defensor a las tropas atacantes.
 * Las tropas atacantes absorben el daño en orden hasta agotarlo.
 *
 * @param {import('../../models/troop').Troop[]} attackingTroops
 * @param {number} damageAmount - Daño total que inflige el defensor.
 * @returns {{ troopsDestroyed: import('../../models/troop').Troop[] }}
 */
function _applyDamageToAttacker(attackingTroops, damageAmount) {
  let remainingDamage = damageAmount;
  const troopsDestroyed = [];

  for (const troop of attackingTroops) {
    if (remainingDamage <= 0) break;
    remainingDamage = troop.takeDamage(remainingDamage);
    if (troop.isDead()) {
      troopsDestroyed.push(troop);
    }
  }

  return { troopsDestroyed };
}
