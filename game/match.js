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

module.exports = { matchResult };
