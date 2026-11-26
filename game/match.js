/*
 * Resultado de la partida (docs/GAMEPLAY_SPEC.md, etapa 5). Termina antes de tiempo si queda una
 * sola serpiente viva, o ninguna persona viva. Si se acaba el tiempo, gana la más larga de las vivas.
 * Si varias empatan, ganan todas.
 */
'use strict';

const lengthOf = player => (player.segments ? player.segments.length : 0);

// -> { ranking: [{ id, name, color, length, eliminated? }], winners: [id] }
// ranking: primero las vivas, de la más larga a la más corta; después las eliminadas, de la última
// en caer a la primera. En un empate se respeta el orden de la sala. Si no queda ninguna viva
// (las últimas cayeron en el mismo paso), ganan las que cayeron en ese paso.
function matchResult(players) {
  const sorted = players
    .map((player, index) => ({ player, index }))
    .sort((a, b) => {
      const outA = !!a.player.gameover;
      const outB = !!b.player.gameover;
      if (outA !== outB) return outA ? 1 : -1;
      const d = outA
        ? (b.player.eliminatedAt || 0) - (a.player.eliminatedAt || 0)
        : lengthOf(b.player) - lengthOf(a.player);
      return d || (a.index - b.index);
    })
    .map(item => item.player);
  const ranking = sorted.map(player => {
    const entry = { id: player.id, name: player.name, color: player.color, length: player.gameover ? 0 : lengthOf(player) };
    if (player.gameover) entry.eliminated = true;
    return entry;
  });
  const first = sorted[0];
  const winners = !first ? [] : sorted
    .filter(player => !!player.gameover === !!first.gameover && (first.gameover
      ? (player.eliminatedAt || 0) === (first.eliminatedAt || 0)
      : lengthOf(player) === lengthOf(first)))
    .map(player => player.id);
  return { ranking, winners };
}

// La partida termina antes de tiempo si quedan una o ninguna serpiente viva, o si entre las vivas
// no queda ninguna persona (en una sala con bots, nadie quiere mirarlos hasta el final)
function matchOver(players) {
  const alive = players.filter(player => !player.gameover);
  return alive.length <= 1 || !alive.some(player => !player.bot);
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

module.exports = { matchResult, matchOver, frenzyFoodTarget, crownHolder };
