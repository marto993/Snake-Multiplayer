# Diseño: ancla, poderes acumulables y cierre de la partida

Este documento define seis cambios de juego, pensados para que la partida tenga más decisiones y un final más intenso: una pausa mínima entre disparos, consumibles que se acumulan, dos consumibles nuevos (boca grande y abanico), una habilidad defensiva (el ancla), más comida en los últimos 20 segundos (el frenesí) y una corona para la serpiente más larga. Se implementan en cuatro etapas, cada una jugable por separado. Las reglas de base no cambian: partida por tiempo, sin choques entre serpientes, gana la más larga.

## Punto de partida

Disparar cuesta un segmento y no tiene más límite de cadencia que no tener un proyectil propio a menos de una celda de donde nacería el nuevo (`index.js:646`). Como el proyectil avanza tres celdas por paso y la cabeza una, al paso siguiente ya hay lugar: el tope es un disparo por paso, unos 15 por segundo. El cliente no filtra la repetición de la barra espaciadora (`public/SnakeGame.js:680`), así que mantenerla apretada dispara a ese ritmo. Leído en el código, sin medirlo en una partida.

La serpiente guarda un solo consumible activo, `activeConsumable` (`public/snakeClass.js:25`), y el único tipo que existe es el escudo. El servidor lo envía en cada frame (`index.js:200`) y en el estado inicial de los espectadores (`index.js:1277`). El cliente lo lee en seis lugares de `public/SnakeGame.js` (líneas 584, 988, 1093, 1296, 1493 y 1812), en la campana de la arena (`public/js/render/arena.js:2391`) y en el marcador y el indicador de escudo del HUD (`public/js/ui/scenes.js:725` y `:860`). Los consumibles aparecen con un temporizador por tipo y un máximo en el mapa por tipo (`index.js:499-577`), pero `initializeConsumableSystem` solo arranca el del escudo.

La comida base se mantiene en `jugadores + foodExtra`: cada vez que se come una, aparece otra (`respawnFood`, `index.js:847`). La partida termina cuando `roundTimeLeft` llega a 0 (`startRoundTimer`, `index.js:749`). El temporizador del HUD ya pasa a la fase de aviso a los 20 segundos (`phaseOf`, `public/js/ui/scenes.js:686`).

## Etapa 1. Pausa entre tiros y efectos acumulables

### Pausa entre tiros

Entre un disparo y el siguiente del mismo jugador pasan al menos 200 ms. El servidor guarda la hora del último disparo en la serpiente y rechaza el pedido si no pasó ese tiempo. Mantener apretada la barra espaciadora, o el botón táctil, dispara entonces a 5 tiros por segundo. La regla de no tener un proyectil propio enfrente se mantiene. La pausa va en la tabla de dificultad (`shotCooldownMs`), con el mismo valor en los tres niveles.

### Efectos acumulables

`activeConsumable` se reemplaza por `effects`: un objeto con un vencimiento (hora del servidor, en ms) por tipo de efecto activo, por ejemplo `{ immunity: 1732300000000, fan: 1732300002500 }`. Cada efecto vence por su cuenta. Tomar un consumible de un tipo que ya está activo reinicia su tiempo a la duración completa; no se suma al que quedaba.

La clase `Snake` deja de exponer `consumeConsumable`, `getActiveConsumable` y `updateConsumables`, y pasa a tener:

- `addEffect(type, durationMs, now)`: activa o renueva un efecto.
- `hasEffect(type, now)`: si está activo.
- `removeEffect(type)`: lo quita (el escudo se quita al bloquear).
- `activeEffects(now)`: copia de los efectos vigentes, para serializar; borra los vencidos.

`hasImmunity()` y `useImmunity()` siguen existiendo sobre `effects`, porque `game/projectiles.js` y `moveProjectiles` las usan. El frame del servidor y el estado de los espectadores mandan `effects` en lugar de `activeConsumable`. En el cliente, cada lugar que hoy lee `activeConsumable` pasa a leer `effects.immunity`. Esta etapa no cambia nada visible: el escudo sigue siendo el único consumible.

## Etapa 2. Boca grande y abanico

### Aparición en el mapa

Los dos consumibles nuevos usan el sistema de temporizadores que ya existe. `initializeConsumableSystem` recorre todos los tipos habilitados de `room.config.consumables` en lugar de arrancar solo el escudo. Cada tipo nuevo aparece cada 12 s, con un máximo de uno en el mapa (dos con 5 jugadores o más), y dura 6 s una vez tomado. Los valores van en la tabla de dificultad, iguales en los tres niveles. Como el escudo, los dos aparecen en su máximo al empezar la partida.

En el mapa, cada consumible tiene silueta y color propios. Los tres comparten el anillo de sonar que hoy tiene el escudo, cada uno en su color: es la seña de que algo se puede tomar. La boca grande es una anémona rosa (`#FF8FD0`), una corona de tentáculos alrededor de una boca abierta. El abanico es una estrella de mar coral (`#FF7A59`) de cinco brazos. La comida es redonda y va de verde a ámbar, y el escudo es una medusa violeta, así que ninguno se confunde por forma. Las medidas exactas se agregan a `docs/VISUAL_SPEC.md`, en la sección de consumibles.

Al tomar uno, el jugador recibe un aviso como el del escudo: "Boca grande: comés desde más lejos" o "Abanico: disparás de a tres".

### Boca grande

Mientras está activa, la serpiente come desde 2,55 celdas, el triple del alcance normal (`EAT_REACH`, `index.js:420`). Vale para la comida base y para los restos, no para los consumibles. En la arena, un anillo tenue del color de la anémona marca el alcance alrededor de la cabeza. Una comida tomada desde lejos viaja hacia la boca en una estela corta antes de la ráfaga de comer, para que se entienda quién la comió.

### Abanico

Mientras está activo, cada disparo sale de a tres: uno en el rumbo de la cabeza y dos abiertos 12° a cada lado. La ráfaga cuesta un segmento, como un disparo simple, y respeta la pausa entre tiros. Cada proyectil nace una celda delante de la cabeza en su propio rumbo y se resuelve por separado; dos de la misma ráfaga pueden cortar a la misma serpiente en el mismo paso. Los dos laterales viajan en `projectileEvents` con `spread: true`, y la arena no repite para ellos la gota de la cola ni el retroceso de la cabeza (`public/js/render/arena.js:2979`), porque el costo fue uno solo.

## Etapa 3. Ancla

### Reglas

El ancla detiene a la serpiente para defenderse. Mientras está anclada:

- no avanza, no gira, no dispara, no come y no toma consumibles;
- un impacto, en la cabeza o en el cuerpo, le quita un solo segmento de la cola, que queda en el mapa como resto (comida de valor 1 que vence a los 10 s, como en `game/remains.js`); con un solo segmento no pierde nada;
- si además tiene escudo, el escudo bloquea primero, se consume y no pierde nada;
- los efectos activos siguen corriendo: el ancla no congela su tiempo.

El ancla dura 1,5 s. Apretar de nuevo la suelta antes. Se recarga en 4 s, contados desde que termina. Pedirla durante la recarga, durante la cuenta regresiva o como espectador no hace nada, y el pedido no queda en espera. Si el jugador mueve el mouse o el joystick mientras está anclado, el servidor guarda el rumbo pedido pero no gira; al soltarse, la serpiente gira hacia ese rumbo con el giro normal. Al terminar la partida o volver a la sala, el ancla y su recarga se reinician.

### Controles

La tecla E, el clic derecho sobre la arena y un segundo botón táctil, junto al de disparo, mandan el mismo evento `anchor` al servidor, que lo interpreta según el estado: anclar si está lista, soltar si ya está anclada. El clic derecho no abre el menú contextual sobre la arena. El botón táctil muestra la recarga y queda atenuado mientras no está lista, como hoy el de disparo cuando la serpiente es muy corta (`public/SnakeGame.js:864`).

### Lo que viaja por red

Cada jugador del frame suma `anchoredUntil` (hora del servidor en que se suelta, o 0) y `anchorReadyAt` (hora del servidor desde la que se puede volver a anclar). El cliente calcula si está anclada y cuánto le falta a la recarga con la hora del servidor del instante dibujado, la misma que usa para desvanecer los restos (`public/SnakeGame.js:592`), no con `Date.now()`, para no depender del desfase de reloj. Un impacto contra una serpiente anclada viaja en `hitEvents` con `anchored: true` y `segmentsLost: 1`.

La tabla de dificultad suma `anchor: { lastsMs, rechargeMs }`, igual en los tres niveles.

### Cómo se ve

Anclada, la criatura se cierra: el cuerpo deja de ondular, un contorno perla lo recubre como una coraza y los fotóforos bajan de brillo. Sobre la cabeza, un anillo se vacía en el 1,5 s que dura. Un impacto contra una serpiente anclada no desprende la cola: suelta chispas que rebotan, un anillo seco y el texto "−1". La recarga no se ve en la arena: se ve en el botón táctil y en el HUD propio. Los valores exactos se agregan a `docs/VISUAL_SPEC.md`, en el catálogo de efectos.

### HUD propio

El indicador del escudo del HUD (`public/js/ui/scenes.js:741-776`) pasa a ser una fila de indicadores, uno por efecto activo, cada uno con su icono y su tiempo restante. Para quien juega con teclado o mouse, la fila suma un indicador del ancla con tres estados: lista (con la tecla "E"), anclada y recargando. En pantallas táctiles ese indicador no aparece, porque el botón ya lo muestra. El marcador de jugadores sigue mostrando solo el escudo, que es lo que le importa a quien apunta.

## Etapa 4. Frenesí final y corona

### Frenesí

Cuando a la partida le quedan 20 segundos, la comida base sube un 50 %: de `jugadores + foodExtra` a `round((jugadores + foodExtra) × 1,5)`. Con dos jugadores en el nivel medio pasa de 22 a 33. La comida nueva aparece de a una por paso del servidor hasta llegar a la cantidad nueva, y desde ahí `respawnFood` la mantiene. Los valores de la comida no cambian, ni los restos. El servidor marca `gameState.frenzy` y lo manda en cada frame. Al empezar, el cliente muestra un aviso ("Frenesí: más comida hasta el final") y un pulso del fondo. El temporizador ya cambia de color a los 20 segundos.

Con `ROUND_TIME` de 20 o menos, el frenesí empieza en el primer segundo de la partida. La tabla de dificultad suma `frenzy: { lastSeconds, foodBoost }`, igual en los tres niveles.

### Corona

La serpiente más larga lleva una corona de luz sobre la cabeza, siempre derecha en la pantalla, como las etiquetas de nombre. La decide el servidor en cada paso con una función pura de `game/match.js` y la manda en `gameState.leaderId`, así todos ven la misma. Si hay empate en el largo máximo, la conserva quien ya la tenía; si no la tenía ninguno de los empatados, no la lleva nadie. Por eso no aparece al empezar, cuando todas miden 3, y no salta de una serpiente a otra en cada paso. Solo existe durante la partida.

## Valores

Todos van en `game/difficulty.js`, con el mismo valor en los tres niveles, para poder ajustarlos por nivel después sin tocar el resto del código.

| Valor | Cantidad |
|---|---|
| Pausa mínima entre disparos | 200 ms |
| Boca grande: dura / alcance | 6 s / 2,55 celdas |
| Abanico: dura / apertura | 6 s / 12° a cada lado |
| Boca grande y abanico en el mapa | cada 12 s, máximo 1 (2 con 5 jugadores o más) |
| Ancla: dura / recarga | 1,5 s / 4 s desde que termina |
| Ancla: daño por impacto | 1 segmento |
| Frenesí: desde / comida base | últimos 20 s / +50 % |

## Cómo se verifica

Cada etapa suma pruebas en `test/` para lo que carga en Node sin navegador:

- **Etapa 1**: efectos que vencen por separado y se renuevan sin sumar (`test/snake.test.js`); valores nuevos de la tabla (`test/difficulty.test.js`).
- **Etapa 2**: los rumbos del abanico (función pura en `game/projectiles.js`).
- **Etapa 3**: anclar, soltar antes, recarga y pedidos rechazados (`test/snake.test.js`); el daño de un impacto con ancla (`game/remains.js`).
- **Etapa 4**: la cantidad de comida del frenesí y la corona con empates (`game/match.js`).

El juego se prueba a mano en cada etapa con `npm run dev` y dos ventanas (una en incógnito), y con `ROUND_TIME=30` para llegar rápido al frenesí. Lo que hay que mirar: que mantener el disparo dé 5 tiros por segundo, que el escudo siga bloqueando, que dos efectos se vean y venzan por separado, que el ancla frene en seco y aguante un impacto con un solo segmento, que el botón táctil muestre la recarga (emulación táctil de DevTools) y que la consola no tenga errores.

## Pendiente de ajuste

Los valores son un punto de partida para ajustar jugando. Lo más probable es que haya que tocar la recarga del ancla (con 4 s se puede anclar casi siempre que llega un disparo de frente), la apertura del abanico y el aumento del frenesí.
