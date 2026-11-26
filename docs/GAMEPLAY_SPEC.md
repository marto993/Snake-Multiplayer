# Diseño: poderes acumulables, cierre de la partida, controles y eliminación

Este documento define los cambios de juego pensados para que la partida tenga más decisiones y un final más intenso: una pausa mínima entre disparos, consumibles que se acumulan, dos consumibles nuevos (boca grande y abanico), más comida en los últimos 20 segundos (el frenesí) y una corona para la serpiente más larga. Suma un cambio de controles: el mouse deja de apuntar y se puede jugar con mando. Las etapas 1 a 4 no tocan las reglas de base (partida por tiempo, sin choques entre serpientes, gana la más larga). La etapa 5 sí: cada impacto quita 4 segmentos, la serpiente que se queda sin segmentos sale de la partida, y si queda una sola, gana ella sin esperar al final del tiempo.

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

En el mapa, cada consumible tiene silueta y color propios. Los tres comparten un pulso de baliza, cada uno en su color: es la seña de que algo se puede tomar. La boca grande es un agujero negro rosa (`#F29BC9`) visto de frente, con un disco de acreción en espiral. El abanico es una estrella triple coral (`#F0875F`). La comida son planetas que van de verde a ámbar, y el escudo es una aurora violeta, así que ninguno se confunde por forma. Las medidas exactas se agregan a `docs/VISUAL_SPEC.md`, en la sección de consumibles.

Al tomar uno, el jugador recibe un aviso como el del escudo: "Boca grande: comés desde más lejos" o "Abanico: disparás de a tres".

### Boca grande

Mientras está activa, la serpiente come desde 2,55 celdas, el triple del alcance normal (`EAT_REACH`, `index.js:420`). Vale para la comida base y para los restos, no para los consumibles. En la arena, un anillo tenue del color del agujero negro marca el alcance alrededor de la cabeza, con motas de polvo que caen en espiral hacia la boca. Una comida tomada desde lejos viaja hacia la boca en una estela corta antes de la ráfaga de comer, para que se entienda quién la comió.

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

La lectura del mando (ejes, zona muerta, cruceta y botones a un rumbo y un disparo) va en un módulo propio, `public/js/input/pad.js`, que también carga en Node para probarlo. `SnakeGame.js` lo consulta en cada cuadro, junto con el joystick táctil. Lee todos los mandos conectados, porque algunos teclados y receptores se anuncian como mando y pueden ocupar el primer lugar: el rumbo sale del primero que lo da y el disparo de cualquiera.

El stick y el joystick táctil dan cualquier ángulo, más precisión que las ocho direcciones del teclado. Para probar empiezan así; un solo valor (`STICK_SNAP` en `SnakeGame.js`, 0 para cualquier ángulo, 8 para redondear a ocho rumbos) cambia los dos si hace falta igualarlos.

## Etapa 5. Eliminación

### Punto de partida

Con las reglas de las etapas 1 a 4, el largo que una serpiente junta durante la partida casi no pesa en el resultado. Un impacto en el cuerpo corta desde el segmento tocado hasta la cola (`cutSnake`, `game/remains.js:15`), así que un disparo cerca de la cabeza le saca casi todo a una serpiente larga, y con `jugadores + foodExtra` comidas en la arena (22 con dos jugadores en el nivel medio) y el frenesí al final, volver a crecer es rápido. Ser larga es más un riesgo que una ventaja: el blanco es más grande y se puede perder de un tiro. Nadie puede quedar afuera, así que tampoco cuesta nada no jugar hasta el final.

Se midió con una copia de `tools/bot-duel.js` sobre las reglas de `main` (commit `e876c38`): 4 bots `hard`, de 100 a 200 partidas de 120 s por regla. En la tabla, "líder" es la serpiente más larga a los 110 s, y el "pasivo" es un bot que sigue derecho sin disparar hasta los últimos 10 s. Con 4 jugadores, el azar da 25 % en las dos columnas.

| Regla | Terminan antes de tiempo | El líder gana | El pasivo gana |
|---|---|---|---|
| Actual (corte hasta la cola, sin eliminación) | 0 % | 26 % | 26 % |
| 3 por impacto y eliminación | 2 % | 65 % | 21 % |
| 4 por impacto y eliminación | 18 % | 77 % | 11 % |
| 5 por impacto y eliminación | 37 % | 84 % | 7 % |

Con las reglas actuales, el largo a 10 s del final no anticipa nada, y no hacer nada rinde lo mismo que jugar. Con daño fijo el largo acumulado sí cuenta. Desde 4 por impacto, quedarse pasivo deja de convenir y una de cada cinco partidas termina antes de tiempo (una de cada cuatro en duelo). Bajar la comida a la mitad o sacar el frenesí casi no cambió cuántas partidas terminan antes (3 % y 2 % con 3 por impacto): la palanca es el daño. En esas mediciones los bots todavía calculaban el daño con la regla vieja y no salían a rematar a una serpiente corta; con personas, las partidas que terminan antes deberían ser más.

### Daño fijo

Cada impacto quita `hitDamage` segmentos (4) de la cola, toque donde toque. Lo que se pierde queda en el mapa como restos, igual que hoy (`dropRemains`). El impacto en la cabeza hace el mismo daño: `headshot` sigue viajando en `hitEvents` solo para el efecto visual y la vibración del mando. El escudo bloquea como siempre. Los disparos propios también lastiman a quien los tiró, como hoy.

`cutSnake(segments, damage)` deja de recibir el índice del segmento tocado y devuelve `{ kept, lost }` con los últimos `min(damage, largo)` segmentos en `lost`. Si `kept` queda vacío, la serpiente es eliminada.

### Eliminación

Una serpiente eliminada pasa a `gameover`, se queda sin segmentos y sin efectos, y el servidor anota `eliminatedAt` (la hora del paso en que cayó). Sus últimos segmentos quedan como restos. Desde ahí no se mueve, no dispara, los proyectiles la ignoran y la corona la saltea; buena parte de esto ya existe en el servidor por el `gameover` del snake clásico (`index.js:1011`, `index.js:1362`, `index.js:1580`, `game/projectiles.js:33`, `game/match.js:60`). El evento del impacto lleva `eliminated: true`. Disparar no puede eliminar a nadie: hacen falta 2 segmentos para tirar y el tiro cuesta uno.

`Snake.GameOver()`, que no se usaba, se reemplaza por `eliminate(now)`. `reset()` vuelve `eliminatedAt` a `null`.

El jugador eliminado sigue en la sala y mira el resto de la partida en la misma escena. Los controles táctiles se ocultan.

### Fin de la partida

Al final de cada paso, después de mandar el frame (así todos ven el último impacto), el servidor revisa si la partida terminó: quedan una o ninguna serpiente viva, o entre las vivas no queda ninguna persona. Lo segundo cubre las salas con bots: si las personas quedaron afuera, nadie quiere mirar a los bots hasta el final. La función es pura y va en `game/match.js` (`matchOver(players)`). Si termina, llama a `endMatch` como cuando se acaba el tiempo.

También se revisa cuando alguien se va en plena partida. Si quedan menos de `minPlayers` jugadores, la partida se corta como hoy (`abortMatch`); si no, puede terminar por eliminación: irse equivale a quedar afuera.

`gameEnd` suma `ending`: `'time'` si se acabó el tiempo, `'elimination'` si terminó antes.

### Clasificación

Primero las serpientes vivas, de la más larga a la más corta; después las eliminadas, de la última en caer a la primera. En un empate se respeta el orden de la sala. Ganan las vivas más largas (en un empate, todas). Si no queda ninguna viva, porque las últimas cayeron en el mismo paso, ganan las que cayeron en ese paso.

Cada entrada de `ranking` suma `eliminated: true` si la serpiente cayó; su `length` es 0. En la base de datos, `finalScore` guarda ese largo y `won` sale de `winners`, como hoy. Las partidas con bots siguen sin contar para el ranking global.

### Escudo al nacer

Todas las serpientes nacen en columna a 3 celdas de distancia (`getPlayerSpawnPosition`, `index.js:436`) y con 3 segmentos, así que cualquier impacto en el arranque elimina. En la medición con 8 bots y 3 por impacto, la primera eliminación llegaba a los 7 s. Para no quedar afuera antes de poder moverse, al "¡Ya!" cada serpiente recibe el escudo por `spawnShield` segundos (3). Mientras dura, bloquea todos los disparos sin gastarse: `startGame` anota `gameState.spawnGuardUntil` y `moveProjectiles` no consume el escudo antes de esa hora. Después vence como cualquier escudo; si la serpiente tomó uno en el mapa mientras tanto, ese sí se gasta al bloquear. Se ve con la magnetosfera que ya existe (`docs/VISUAL_SPEC.md`, 5.7).

Un escudo que bloquea un solo disparo no alcanzaba: con el disparo sostenido (5 por segundo) o el abanico, el primer tiro lo rompe y el siguiente elimina. En el simulador, un bot `hard` quedaba fuera a los 1,2 s contra un `extreme`. Los bots saben que el escudo de nacer no se rompe (`world.guardUntil`) y no gastan tiros en él.

### Bots

Los bots aprenden la regla nueva. `segmentsLost` (`game/bots.js:265`) devuelve `min(hitDamage, largo)` en vez del corte hasta la cola. Un disparo que elimina a un rival vale más que los segmentos que le saca, porque saca a un competidor de la partida. Un disparo que viene y me eliminaría pesa más al esquivar y al decidir si busco un escudo.

Los bots también dejan de dispararse encima. Deciden el tiro `delay` pasos antes de que salga (la reacción: 4 pasos en `medium`), y en ese tiempo la serpiente sigue girando; con un cuerpo largo que cruza un portal, la cola queda adelante en la misma fila. Con las reglas de `main`, un `medium` contra un `easy` perdía unos 56 segmentos por partida con sus propios disparos, y ganaba igual porque sus cortes eran mucho más grandes. Con daño fijo, eso lo dejaba perdiendo contra `easy`. Ahora, al salir el tiro, el bot revisa si su propio cuerpo quedó en la línea (`ownBodyInLine`) y, si es así, se lo aguanta.

`tools/bot-duel.js` repite las reglas nuevas del paso (daño fijo, eliminación, escudo al nacer, fin por eliminación) y su tabla suma cuántas veces quedó afuera cada bot. El orden de los niveles en partidas con semilla (`test/bots.test.js`) se tiene que mantener.

### En pantalla

Las medidas y los textos exactos van en `docs/VISUAL_SPEC.md`. En resumen:

- **Arena.** Una eliminación es un impacto con un final más grande: el cuerpo entero se desprende y se apaga como la cola de un impacto, la ráfaga es mayor, el texto flotante dice "Fuera" en lugar de "−4", y la sacudida y el pulso del fondo son más fuertes para la víctima.
- **Avisos.** La víctima recibe "Quedaste fuera: sigues mirando hasta el final". El resto ve "{atacante} dejó fuera a {víctima}", o "{víctima} quedó fuera" si se lastimó con su propio disparo.
- **Marcador.** La fila de una eliminada ya se atenúa (`.hud-row.is-out`); en lugar del largo muestra "fuera".
- **Meta.** La cuenta regresiva y el "¡Ya!" dicen "Gana la última en pie o la más larga"; la meta del HUD, "Última en pie o la más larga".
- **Final.** Las eliminadas muestran "fuera" en lugar del largo. Si la partida terminó por eliminación y quedó una sola, el mensaje es "Última en pie, con {n} segmentos."; si las últimas cayeron a la vez, "{A} y {B} caen a la vez."
- **Espectadores.** Quien entra a mirar una partida con eliminadas recibe serpientes sin segmentos: `createLocalSnake` (`public/SnakeGame.js:1073`) no puede leer `segments[0]` sin revisar que exista.

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
| Daño por impacto | 4 segmentos, desde la cola |
| Escudo al nacer | 3 s (bloquea todo sin gastarse) |

## Cómo se verifica

Cada etapa suma pruebas en `test/` para lo que carga en Node sin navegador:

- **Etapa 1**: efectos que vencen por separado y se renuevan sin sumar (`test/snake.test.js`); valores nuevos de la tabla (`test/difficulty.test.js`).
- **Etapa 2**: los rumbos del abanico (función pura en `game/projectiles.js`).
- **Etapa 3**: la cantidad de comida del frenesí y la corona con empates (`game/match.js`).
- **Etapa 4**: la lectura del mando: zona muerta, cruceta, prioridad entre stick y cruceta, botones de disparo y mandos sin mapeo estándar (`test/pad.test.js`).
- **Etapa 5**: el daño fijo y el impacto que deja sin segmentos (`test/remains.test.js`); la clasificación con eliminadas, el empate de las que caen en el mismo paso y `matchOver` con y sin personas vivas (`test/match.test.js`); `eliminate` y `reset` (`test/snake.test.js`); los valores nuevos de la tabla (`test/difficulty.test.js`); que un bot prefiera el disparo que elimina y que el orden de los niveles se mantenga (`test/bots.test.js`).

El juego se prueba a mano en cada etapa con `npm run dev` y dos ventanas (una en incógnito), y con `ROUND_TIME=30` para llegar rápido al frenesí. Lo que hay que mirar: que mantener el disparo dé 5 tiros por segundo (barra, botón táctil y mando), que el escudo siga bloqueando, que dos efectos se vean y venzan por separado, que mover el mouse no gire la serpiente y el clic dispare, que el mando gire y dispare, y que la consola no tenga errores.

Para la etapa 5: en una sala para jugar solo, dejarse eliminar y ver que la partida termina al instante con los bots arriba en la clasificación; con dos ventanas y un bot, que la eliminada siga mirando y que la partida termine cuando cae la otra persona; que una tercera ventana pueda entrar a mirar una partida con eliminadas; y que el escudo al nacer bloquee un disparo en los primeros 3 s.

## Pendiente de ajuste

Los valores son un punto de partida para ajustar jugando. Lo más probable es que haya que tocar la apertura del abanico, el aumento del frenesí y si el stick y el joystick táctil se redondean a ocho rumbos.

Con la etapa 5 implementada y los bots al tanto de la regla, `tools/bot-duel.js` da esto con 4 bots `hard` en 100 partidas de 120 s: el 26 % termina antes de tiempo y la partida dura 111 s en promedio. Un bot que sigue derecho sin disparar hasta los últimos 10 s gana 1 de 100 (en `main` ganaba 26 de 100).

Contra `extreme` no hay partida: un `hard` queda fuera a los 4 s en promedio (60 de 60 partidas), y repartir las salidas por la arena solo lo lleva a 6 s. Ni 5 s de escudo al nacer lo cambian. Con reacción 0, puntería perfecta y 5 tiros por segundo, a 4 segmentos por impacto, una serpiente corta cae en menos de un segundo. Ablandarlo (2 pasos de reacción y 800 ms entre tiros propios) sigue ganando 26 de 30, pero las partidas contra `hard` duran 24 s. Queda por decidir si `extreme` se ajusta así o se deja como desafío.

De la etapa 5 falta ver jugando tres cosas: si 4 por impacto se siente bien o conviene 3 o 5 (es un valor de la tabla); cuánto molesta quedar afuera temprano y mirar el resto de la partida, que puede ser casi dos minutos; y si la serpiente más larga se escapa demasiado, porque con daño fijo cada impacto le pesa menos a quien tiene más segmentos. Si se extraña el tiro preciso, el impacto en la cabeza puede hacer más daño.
