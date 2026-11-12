# Diseño: movimiento continuo y dificultad fija

Este documento define dos cambios al juego. El primero reemplaza la configuración libre de la sala por tres niveles de dificultad con valores fijos. El segundo reemplaza la grilla por un espacio continuo de 4000 × 4000 unidades, donde la serpiente puede doblar en cualquier punto y que habilita, en una etapa visual posterior, dibujarla como un cuerpo de partículas. Primero va la dificultad y después el espacio continuo: fijar la configuración reduce lo que el modelo nuevo tiene que soportar (un solo grosor, tres velocidades) y se puede jugar y ajustar por separado.

Los controles siguen siendo de 4 direcciones. Las reglas básicas se mantienen: rondas por tiempo, sin choques entre serpientes, disparos que cuestan largo y escudo que bloquea un disparo. Cambian valores como la velocidad del disparo y la cantidad de comida, que pasan a depender del nivel.

## Punto de partida

La simulación corre en el servidor sobre una grilla. La arena mide 600 × 600 coordenadas lógicas (`index.js:250`) y el lado de la celda es el tamaño de serpiente elegido en la sala, de 5 a 25 (`index.js:252`). Con el valor por defecto, 20, la grilla es de 30 × 30. El bucle avanza la serpiente una celda por paso, cada `gameSpeed` milisegundos (`index.js:1002`), 83 ms por defecto: unos 12 pasos por segundo, y la serpiente cruza la arena en 2,5 s.

El servidor reconstruye en cada paso un tablero con todas las celdas (`updateGameBoard`, `index.js:419`, llamado en `index.js:1158`) y lo usa para detectar la comida (`index.js:1116`). Los proyectiles avanzan una celda por paso y chocan solo si caen exactamente en la celda de un segmento (`index.js:739`). Entre serpientes no hay colisiones.

Leído en el código, sin reproducirlo en una partida: como el proyectil se mueve y se compara antes de que se muevan las serpientes, una serpiente que cruza su trayectoria en perpendicular puede intercambiar celdas con él sin que se detecte el impacto. Por ejemplo, un proyectil en (5, 0) que baja y una cabeza en (4, 1) que va a la derecha: el proyectil pasa a (5, 1) y no encuentra a nadie, la cabeza entra a (5, 1) después, y en el paso siguiente el proyectil sigue a (5, 2).

La configuración de la sala permite elegir máximo y mínimo de jugadores, velocidad (4 valores), tamaño de serpiente (5 valores) y frecuencia, duración y activación del escudo (`public/index.html:159-216`). El escudo tiene tres valores por defecto distintos según dónde se mire: 3 s en el HTML (`public/index.html:202`), 5 s en el servidor (`index.js:259`) y 13 s en el cliente (`public/SnakeGame.js:1471`).

### La animación entre pasos ya está resuelta

El cliente guarda los frames del servidor en una línea de tiempo (`public/js/net/motion.js`) y dibuja un instante un paso atrás del último, interpolando en línea recta entre los dos frames que lo rodean. Antes perseguía cada posición nueva con un lerp por cuadro, que arrancaba rápido y frenaba antes de cada paso.

Medido con dos jugadores en Chromium headless a 60 cuadros por segundo, durante dos rondas, sobre la posición dibujada de la cabeza propia:

| Medida | Antes | Ahora |
|---|---|---|
| Variación de la velocidad visible | 37 % a 42 % | 2 % |
| Cuadros casi detenidos | hasta 28 | 0 |
| Velocidad media (esperada: 240 px/s) | 219 a 231 px/s | 240 px/s |

Las pruebas de `test/motion.test.js` simulan la misma serpiente a 60 y 144 Hz: la variación queda por debajo de 1 % (antes, 83 % a 144 Hz). Con jitter de red, cada frame que llega corrige el reloj del render unos milisegundos; esa corrección se reparte en el tiempo, sin cambiar la velocidad visible más de 5 %. Con 30 ms de jitter la variación queda en 2,9 %; aplicada de golpe daba 5,1 %, con cuadros de hasta 28 % de desvío. Tampoco interpola con las horas del servidor tal cual: el servidor no emite justo cada paso, y a 42 ms una diferencia de 3 ms cambia la velocidad un 7 %. Cada frame se ubica un paso después del anterior y se corre de a poco hacia su hora real. En la simulación del nivel difícil, con horas del servidor desparejas y jitter de red, la variación baja de 8,7 % a 3,2 % y el peor cuadro de 29 % a 7 %.

El atraso visual respecto del servidor quedó igual o menor a 60 Hz (94 ms contra 104 ms en red local) y unos 27 ms mayor a 144 Hz con 30 ms de latencia y 15 ms de jitter (129 ms contra 102 ms).

Lo que la animación no resuelve: la serpiente solo puede doblar en el borde de una celda, y la escala de 30 × 30 se ve gruesa.

## Dificultad fija

La sala deja de tener panel de configuración y pasa a tener un solo selector con tres niveles: fácil, medio y difícil. El anfitrión lo elige antes de iniciar, como hoy elige la configuración, y la lista de salas del lobby muestra el nivel en lugar de "velocidad normal, con inmunidad" (`public/SnakeGame.js:1640`).

Quedan fijos para todos los niveles:

- **Arena**: 600 × 600 lógicos, como hoy.
- **Grosor de la serpiente**: 12 px, que en la grilla actual da 50 × 50 celdas. Se fija ya en esta etapa, así la escala visual no cambia al pasar al espacio continuo.
- **Rondas**: 3 de 60 s. Se conserva el override de desarrollo `ROUND_TIME`.
- **Jugadores**: mínimo 2, máximo 8. Hoy el máximo configurable es 16, y 16 serpientes en una arena fija quedan apretadas.
- **Largo inicial**: 3 segmentos, en línea detrás de la cabeza, para que la serpiente se vea como criatura desde el arranque. Hoy arranca con 1. Con 3 se puede disparar desde el inicio, y el puntaje de cada ronda sube 2 por jugador respecto de hoy.
- **Escudo**: siempre activo.

Los valores por nivel son un punto de partida para ajustar jugando. La velocidad se expresa como el tiempo que tarda la serpiente en cruzar la arena, para que valga igual en la grilla y en el espacio continuo:

| Valor | Fácil | Medio | Difícil |
|---|---|---|---|
| Cruza la arena en | 3,5 s | 2,7 s | 2,1 s |
| Disparo, respecto de la serpiente | 2 × | 2 × | 3 × |
| Comida en la arena | jugadores + 14 | jugadores + 10 | jugadores + 7 |
| Escudo: aparece cada / dura | 6 s / 7 s | 10 s / 5 s | 15 s / 3 s |

La primera versión tenía jugadores + 8, + 5 y + 3. Jugando, las serpientes crecían despacio, y la comida se subió a los valores de la tabla. Más comida acorta poco la búsqueda: la distancia a la más cercana baja con la raíz cuadrada de la cantidad (con dos jugadores, de 11 celdas con 7 comidas a 9 con 12). Por eso la palanca principal para crecer rápido son los restos.

**Restos**: lo que pierde una serpiente por un impacto (3 segmentos de la cola si le pegan en la cabeza, o desde el segmento tocado hasta la cola si le pegan en el cuerpo) queda en el mapa como comida de valor 1, una por celda, durante 10 s. Un corte de más de 30 segmentos suelta 30 comidas repartidas a lo largo del cuerpo, con el valor total repartido entre ellas (hasta 5 cada una). A diferencia de la comida base, los restos no reaparecen al comerlos. Un buen disparo se vuelve la forma más rápida de crecer, para quien disparó o para el que llegue antes (`game/remains.js`).

Como referencia, antes de esta etapa la velocidad "Normal" cruzaba la arena en 2,5 s, el disparo viajaba a la misma velocidad que la serpiente y la comida era jugadores + 5, salvo con 2 jugadores, que eran 7 (`index.js:487`).

En la grilla de 50 × 50, los tiempos de cruce dan pasos de 70, 54 y 42 ms. El servidor ya acepta pasos desde 40 ms (`index.js:249`). El disparo avanza 2 o 3 celdas por paso y se compara contra cada celda intermedia, no solo contra la de llegada.

El servidor recibe `{ difficulty: 'easy' | 'medium' | 'hard' }` en `updateRoomConfig` (`index.js:1312`) y arma la configuración completa desde una tabla, en lugar de validar campo por campo en `validateRoomConfig` (`index.js:244`). El resto del código sigue leyendo `room.config` como hoy, así que el cambio queda concentrado ahí y en el panel de la sala.

## Espacio continuo

### Coordenadas y unidades

Las posiciones del servidor pasan a ser enteros de 0 a 3999 en cada eje. Una unidad equivale a 0,15 px lógicos, y el cliente convierte al dibujar. No hay tablero: la memoria no depende de la resolución. Con la arena dibujada a 560 px, como en una ventana de 1280 px de ancho, cada pixel de pantalla abarca unas 7 unidades: más precisión de la que se puede ver.

Medidas fijas en unidades:

- **Cuerpo**: 80 unidades de grosor (los 12 px de la etapa anterior). Es también la unidad de largo y de puntaje.
- **Velocidad**: 1143, 1481 y 1905 unidades por segundo según el nivel (los tiempos de cruce de la tabla).
- **Paso del servidor**: 50 ms (20 por segundo) para todos los niveles. La velocidad ya no depende del paso.

### La serpiente

Cada serpiente es una línea quebrada de tramos rectos: la cabeza, las esquinas en orden y el extremo de la cola, más su largo total en unidades. Con 4 direcciones, todos los tramos son horizontales o verticales. Avanzar es mover la cabeza en su dirección y recortar la cola hasta que el largo total vuelva a ser el que corresponde.

Las reglas de largo son las de hoy, con un cuerpo de 80 unidades en el lugar de un segmento:

- Arranca con 3 cuerpos de largo, como en la etapa de dificultad.
- La comida suma su valor (de 1 a 5) en cuerpos; el largo crece a medida que la cabeza avanza, como hoy crece de a un segmento por paso.
- El puntaje es el largo dividido 80, redondeado hacia abajo. La escala del ranking no cambia.

### Giros

El jugador sigue mandando `newMove` con una flecha (`index.js:1584`), y el servidor conserva la cola de hasta 3 giros y el rechazo de la vuelta de 180° (`public/snakeClass.js:168-189`). Cambian dos cosas:

- **El giro ocurre donde el jugador apretó, no en el próximo paso.** El servidor anota la hora de llegada de cada giro y, al procesar el paso, mueve la cabeza en línea recta hasta ese instante, dobla y sigue. Con pasos de 50 ms, esperar al paso correría la esquina hasta 95 unidades (14 px) en el nivel difícil.
- **Entre dos esquinas tiene que haber al menos un cuerpo (80 unidades).** Un giro que llega antes queda en cola hasta cumplirlo. Sin esta regla, dos giros seguidos producen una vuelta en U más angosta que el cuerpo y la serpiente parece meterse en sí misma. Hoy la celda ya impone esa distancia mínima.

La segunda regla tiene un efecto útil sobre la red: una serpiente nunca tiene más esquinas que cuerpos de largo.

### Colisiones

Todas se resuelven con geometría, sin tablero:

- **Comida y escudo**: la cabeza los toma si la distancia entre centros es menor que 80 unidades. Se mide contra todo el tramo que recorrió la cabeza en el paso, no solo contra su posición final, para que una cabeza rápida no pase por encima sin comerlos.
- **Proyectil contra cuerpo**: primero se mueven las serpientes y después los proyectiles. El tramo que recorrió cada proyectil en el paso se compara contra los tramos de cada cuerpo, tratados como rectángulos de 80 unidades de ancho. Como el cuerpo es el rastro de la cabeza, una serpiente que cruzó la trayectoria durante el paso ya dejó su rastro ahí, y el impacto se detecta. Esto corrige el caso descrito en el punto de partida.
- **Entre serpientes**: siguen sin colisión.

### Disparos

Las reglas de hoy, pasadas a unidades:

- Disparar requiere 2 cuerpos de largo y cuesta 1 (`index.js:658`).
- El proyectil nace un cuerpo delante de la cabeza y viaja a 2 o 3 veces la velocidad de la serpiente según el nivel.
- Un impacto a menos de un cuerpo de la cabeza quita 3 cuerpos, dejando al menos 1 (`index.js:758`). Si el impacto es más atrás, el cuerpo se corta ahí: el largo pasa a ser la distancia desde la cabeza hasta el impacto.
- El escudo bloquea un disparo y se consume, como hoy.
- Hoy no se puede disparar si hay un proyectil propio en la celda de adelante (`index.js:674`). La regla equivalente es no disparar si hay un proyectil propio a menos de un cuerpo de la cabeza.

### Portales

La arena sigue envolviendo en los bordes. El cuerpo se guarda en coordenadas sin envolver, así la línea quebrada es continua aunque cruce un borde. Las posiciones se envuelven (módulo 4000) solo al comparar colisiones y al dibujar, y un tramo que cruza el borde se parte en dos para compararlo. La normalización de las coordenadas sin envolver, para que no crezcan durante la ronda, queda a criterio de quien lo implemente.

En el cliente, la arena ya corta el trazo cuando dos puntos consecutivos quedan a más de media arena (`public/js/render/arena.js:1185`), y la línea de tiempo ya interpola por el lado corto del envoltorio.

### Lo que viaja por red

Cada jugador de `gameLogicFrame` reemplaza `segments` por:

- `path`: lista plana de enteros `[x0, y0, x1, y1, ...]` con la cabeza, las esquinas y el extremo de la cola.
- `length`: largo en unidades.
- `direction`: igual que hoy.

Las coordenadas de comida, consumibles, proyectiles y eventos (`foodEvents`, `hitEvents`, `portals` y el resto) pasan a unidades, con el centro del objeto en lugar de la esquina de la celda.

Medido hoy con dos jugadores y serpientes de 1 a 4 segmentos, un `gameLogicFrame` pesa en promedio 1128 bytes, de los cuales unos 1096 no dependen del largo de las serpientes (comida, datos de cada jugador, eventos). Cada segmento suma unos 13,5 bytes. Una esquina con dos enteros de hasta 4 cifras pesa menos que un segmento, y por la regla de giros hay a lo sumo una esquina por cuerpo de largo. Por eso, a igual largo, un frame nuevo no pesa más que uno actual. Lo que crece es la cantidad de frames: 20 por segundo en lugar de 12. Es una estimación a partir de esa medición, y hay que medirla de nuevo con 8 jugadores.

Servidor y cliente cambian el formato a la vez. Una pestaña abierta durante un deploy quedaría con el cliente viejo, así que conviene que el servidor mande una versión de protocolo al conectar y que el cliente recargue la página si no coincide.

### El cliente

La línea de tiempo de `motion.js` sigue siendo la base: guarda frames con la hora del servidor y dibuja un paso atrás. Cambia cómo se calcula el cuerpo en un instante intermedio. Como el cuerpo es el rastro de la cabeza, el cuerpo en el instante dibujado es el `path` del frame siguiente, sin el tramo inicial que la cabeza todavía no recorrió en ese instante, y recortado al largo interpolado entre los dos frames.

La arena hoy dibuja el cuerpo a partir de puntos separados por una celda (`public/js/render/arena.js:2356-2364`) y escala el grosor con el tamaño de celda (`public/js/render/arena.js:1182`). Para no reescribirla, el cliente remuestrea la línea quebrada en puntos cada 12 px y se los entrega con tamaño de celda 12. La conversión de unidades a pixeles y de centro a esquina se hace en un solo lugar del cliente, antes de la arena.

`snakeClass.js` hoy lo usan servidor y cliente (`public/snakeClass.js:345-349`). El cliente ya no lo necesita para moverse, porque no predice y dibuja desde los frames. Si se reescribe con el modelo nuevo, conviene que siga compartido: deja abierta la predicción de la serpiente propia.

### Lo visual que habilita

Con el cuerpo como línea continua, las partículas son una forma de dibujarlo y no existen en el servidor. Algunas posibilidades: el cuerpo como cuentas de luz que ondulan, la parte cortada por un impacto desprendida en partículas sueltas, la comida como un cúmulo que orbita y el disparo como un chorro. Ninguna es necesaria para el cambio de modelo. Se especifican aparte, en `docs/VISUAL_SPEC.md`, una vez que el espacio continuo funcione con el dibujo actual.

## Cómo se verifica

Cada etapa se valida con las mismas mediciones que se usaron para la animación, más las propias del cambio:

- **Geometría** (espacio continuo): pruebas en Node de giros con distancia mínima, recorte de cola, colisiones barridas (incluido el cruce perpendicular del punto de partida), cortes por impacto y envoltorio en los cuatro bordes.
- **Fluidez**: dos jugadores en Chromium headless, midiendo la velocidad dibujada de la cabeza dentro de cada ronda. Variación por debajo del 5 % y ningún cuadro detenido, como hoy.
- **Efectos**: cada evento llega una sola vez a su gancho de la arena, sin errores de consola.
- **Red**: tamaño promedio de `gameLogicFrame` con 8 jugadores, a 20 frames por segundo.
- **Rendimiento**: 8 serpientes con la CPU ralentizada 4 veces, como en las pruebas del rediseño.

## Pendiente de ajuste

Los valores de la tabla de dificultad son un punto de partida y se ajustan jugando. El disparo del nivel difícil es 3 × para que en la grilla avance celdas enteras; en el espacio continuo podría bajar a 2,5 ×.

Fuera de alcance: giro libre (se decidió mantener 4 direcciones), un mundo más grande que la pantalla con cámara, controles táctiles, audio y predicción de la serpiente propia.
