/*
 * Resultado de la partida: gana la serpiente más larga cuando se acaba el tiempo.
 * Si varias empatan en el largo máximo, ganan todas.
 */
'use strict';

// -> { ranking: [{ id, name, color, length }], winners: [id] }
// ranking va de la más larga a la más corta; en un empate se respeta el orden de la sala.
function matchResult(players) {
  const ranking = players
    .map((player, index) => ({
      entry: { id: player.id, name: player.name, color: player.color, length: player.segments ? player.segments.length : 0 },
      index
    }))
    .sort((a, b) => (b.entry.length - a.entry.length) || (a.index - b.index))
    .map(item => item.entry);
  const best = ranking.length ? ranking[0].length : 0;
  const winners = ranking.filter(entry => entry.length === best).map(entry => entry.id);
  return { ranking, winners };
}

// Frenesí: cuánta comida base hay en la arena en los últimos segundos (la normal es jugadores + foodExtra)
function frenzyFoodTarget(playerCount, foodExtra, foodBoost) {
  return Math.round((playerCount + foodExtra) * (1 + foodBoost));
}

// Corona: la lleva la serpiente más larga. En un empate la conserva quien ya la tenía (prevId); si
// no la tenía ninguno de los empatados, no la lleva nadie. Así no aparece al empezar, cuando todas
// miden lo mismo, y no salta de una a otra en cada paso.
function crownHolder(players, prevId) {
  let best = 0;
  const top = [];
  for (const player of players) {
    if (player.gameover) continue;
    const length = player.segments ? player.segments.length : 0;
    if (length > best) { best = length; top.length = 0; top.push(player.id); }
    else if (length === best && length > 0) top.push(player.id);
  }
  if (top.length === 1) return top[0];
  return top.includes(prevId) ? prevId : null;
}

module.exports = { matchResult, frenzyFoodTarget, crownHolder };
