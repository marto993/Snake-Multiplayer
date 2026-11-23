# Diseño: poderes acumulables, cierre de la partida y controles

Este documento define los cambios de juego pensados para que la partida tenga más decisiones y un final más intenso: una pausa mínima entre disparos, consumibles que se acumulan, dos consumibles nuevos (boca grande y abanico), más comida en los últimos 20 segundos (el frenesí) y una corona para la serpiente más larga. Suma un cambio de controles: el mouse deja de apuntar y se puede jugar con mando. Las reglas de base no cambian: partida por tiempo, sin choques entre serpientes, gana la más larga.

Se probó también una habilidad defensiva, el ancla (frenar la serpiente 1,5 s y perder un solo segmento por impacto, con recarga), y se descartó: jugando no agregaba decisiones interesantes y sumaba un botón.

## Punto de partida

Disparar cuesta un segmento y no tiene más límite de cadencia que no tener un proyectil propio a menos de una celda de donde nacería el nuevo (`index.js:646`). Como el proyectil avanza tres celdas por paso y la cabeza una, al paso siguiente ya hay lugar: el tope es un disparo por paso, unos 15 por segundo. El cliente no filtra la repetición de la barra espaciadora (`public/SnakeGame.js:680`), así que mantenerla apretada dispara a ese ritmo. Leído en el código, sin medirlo en una partida.

La serpiente guarda un solo consumible activo, `activeConsumable` (`public/snakeClass.js:25`), y el único tipo que existe es el escudo. El servidor lo envía en cada frame (`index.js:200`) y en el estado inicial de los espectadores (`index.js:1277`). El cliente lo lee en seis lugares de `public/SnakeGame.js` (líneas 584, 988, 1093, 1296, 1493 y 1812), en la campana de la arena (`public/js/render/arena.js:2391`) y en el marcador y el indicador de escudo del HUD (`public/js/ui/scenes.js:725` y `:860`). Los consumibles aparecen con un temporizador por tipo y un máximo en el mapa por tipo (`index.js:499-577`), pero `initializeConsumableSystem` solo arranca el del escudo.

La comida base se mantiene en `jugadores + foodExtra`: cada vez que se come una, aparece otra (`respawnFood`, `index.js:847`). La partida termina cuando `roundTimeLeft` llega a 0 (`startRoundTimer`, `index.js:749`). El temporizador del HUD ya pasa a la fase de aviso a los 20 segundos (`phaseOf`, `public/js/ui/scenes.js:686`).

## Etapa 1. Pausa entre tiros y efectos acumulables

### Pausa entre tiros

Entre un disparo y el siguiente del mismo jugador pasan al menos 200 ms. El servidor guarda la hora del último disparo en la serpiente y rechaza el pedido si no pasó ese tiempo. Acepta uno que llega hasta 25 ms antes, porque el jitter de red adelanta algunos pedidos del disparo sostenido, pero lo cuenta como hecho a su hora: la cadencia nunca pasa de uno cada 200 ms. Mantener apretada la barra espaciadora, o el botón táctil, dispara entonces a 5 tiros por segundo. La regla de no tener un proyectil propio enfrente se mantiene. La pausa va en la tabla de dificultad (`shotCooldownMs`), con el mismo valor en los tres niveles.

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

### HUD propio

El indicador del escudo del HUD (`public/js/ui/scenes.js:741-776`) pasa a ser una fila de indicadores, uno por efecto activo, cada uno con su icono y su tiempo restante. El marcador de jugadores sigue mostrando solo el escudo, que es lo que le importa a quien apunta. El tiempo restante se cuenta con la hora del servidor (la del instante dibujado), no con el reloj del cliente, que puede estar desfasado.

## Etapa 3. Frenesí final y corona

### Frenesí

Cuando a la partida le quedan 20 segundos, la comida base sube un 50 %: de `jugadores + foodExtra` a `round((jugadores + foodExtra) × 1,5)`. Con dos jugadores en el nivel medio pasa de 22 a 33. La comida nueva aparece de a una por paso del servidor hasta llegar a la cantidad nueva, y desde ahí `respawnFood` la mantiene. Los valores de la comida no cambian, ni los restos. El servidor marca `gameState.frenzy` y lo manda en cada frame. Al empezar, el cliente muestra un aviso ("Frenesí: más comida hasta el final") y un pulso del fondo. El temporizador ya cambia de color a los 20 segundos.

Con `ROUND_TIME` de 20 o menos, el frenesí empieza en el primer segundo de la partida. La tabla de dificultad suma `frenzy: { lastSeconds, foodBoost }`, igual en los tres niveles.

### Corona

La serpiente más larga lleva una corona de luz sobre la cabeza, siempre derecha en la pantalla, como las etiquetas de nombre. La decide el servidor en cada paso con una función pura de `game/match.js` y la manda en `gameState.leaderId`, así todos ven la misma. Si hay empate en el largo máximo, la conserva quien ya la tenía; si no la tenía ninguno de los empatados, no la lleva nadie. Por eso no aparece al empezar, cuando todas miden 3, y no salta de una serpiente a otra en cada paso. Solo existe durante la partida: al empezar otra, el cliente olvida la corona de la anterior hasta que llega el primer frame nuevo.

## Etapa 4. Controles

### Sin mouse para apuntar

Con el mouse, la serpiente giraba hacia el puntero: apuntar era poner el puntero sobre el rival. Con el teclado, el joystick táctil o un stick se elige una dirección y el ángulo hay que calcularlo. Esa diferencia hacía mucho más fácil apuntar con el mouse, así que el mouse deja de girar la serpiente y desaparece la mira sobre la arena. El clic izquierdo sobre la arena sigue disparando, para quien juega con WASD y el mouse en la otra mano. En los menús, el mouse funciona como siempre.

### Mando

Se puede jugar con un mando por la Gamepad API del navegador. Con el mapeo estándar (mandos Xbox, PlayStation y la mayoría de los genéricos):

- **Stick izquierdo**: el rumbo, como el joystick táctil (empujar a la derecha es ir a la derecha). Por debajo de 0,3 de inclinación no cuenta.
- **Cruceta**: ocho rumbos, como las flechas (dos a la vez, en diagonal).
- **Disparo**: A (Cruz en PlayStation) o el gatillo derecho. Mantenerlo apretado dispara cada `shotCooldownMs`, como la barra espaciadora y el botón táctil.

Con un mando sin mapeo estándar se usan el primer par de ejes como stick y los cuatro primeros botones para disparar. El navegador muestra el mando recién cuando se aprieta un botón; ahí aparece un aviso ("Mando conectado"), y otro si se desconecta. Si el navegador lo permite (Chrome y Edge), el mando vibra al recibir un impacto, más fuerte si es en la cabeza. La Gamepad API solo funciona en contexto seguro: en producción (HTTPS) y en `localhost`, no al abrir el servidor de desarrollo por la IP de la red local.

La lectura del mando (ejes, zona muerta, cruceta y botones a un rumbo y un disparo) va en un módulo propio, `public/js/input/pad.js`, que también carga en Node para probarlo. `SnakeGame.js` lo consulta en cada cuadro, junto con el joystick táctil.

El stick y el joystick táctil dan cualquier ángulo, más precisión que las ocho direcciones del teclado. Para probar empiezan así; un solo valor (`STICK_SNAP` en `SnakeGame.js`, 0 para cualquier ángulo, 8 para redondear a ocho rumbos) cambia los dos si hace falta igualarlos.

## Valores

Los de juego van en `game/difficulty.js`, con el mismo valor en los tres niveles, para poder ajustarlos por nivel después sin tocar el resto del código. La zona muerta del stick va en `public/js/input/pad.js`.

| Valor | Cantidad |
|---|---|
| Pausa mínima entre disparos | 200 ms |
| Boca grande: dura / alcance | 6 s / 2,55 celdas |
| Abanico: dura / apertura | 6 s / 12° a cada lado |
| Boca grande y abanico en el mapa | cada 12 s, máximo 1 (2 con 5 jugadores o más) |
| Frenesí: desde / comida base | últimos 20 s / +50 % |
| Stick del mando: zona muerta | 0,3 |

## Cómo se verifica

Cada etapa suma pruebas en `test/` para lo que carga en Node sin navegador:

- **Etapa 1**: efectos que vencen por separado y se renuevan sin sumar (`test/snake.test.js`); valores nuevos de la tabla (`test/difficulty.test.js`).
- **Etapa 2**: los rumbos del abanico (función pura en `game/projectiles.js`).
- **Etapa 3**: la cantidad de comida del frenesí y la corona con empates (`game/match.js`).
- **Etapa 4**: la lectura del mando: zona muerta, cruceta, prioridad entre stick y cruceta, botones de disparo y mandos sin mapeo estándar (`test/pad.test.js`).

El juego se prueba a mano en cada etapa con `npm run dev` y dos ventanas (una en incógnito), y con `ROUND_TIME=30` para llegar rápido al frenesí. Lo que hay que mirar: que mantener el disparo dé 5 tiros por segundo (barra, botón táctil y mando), que el escudo siga bloqueando, que dos efectos se vean y venzan por separado, que mover el mouse no gire la serpiente y el clic dispare, que el mando gire y dispare, y que la consola no tenga errores.

## Pendiente de ajuste

Los valores son un punto de partida para ajustar jugando. Lo más probable es que haya que tocar la apertura del abanico, el aumento del frenesí y si el stick y el joystick táctil se redondean a ocho rumbos.
