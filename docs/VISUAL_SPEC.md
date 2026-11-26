# Especificación visual: criaturas del vacío

Referencia única del rediseño visual de Snake Multiplayer en la rama `feature/visual-overhaul`. Define el concepto, los tokens, el lenguaje de movimiento, las escenas, el arte de la arena, el HUD, las reglas de accesibilidad y rendimiento, y los textos de la interfaz. Si algo de este documento contradice al código actual, manda este documento. Si contradice al contrato de arquitectura (archivos, APIs, IDs), manda el contrato. Lo que este documento agrega al contrato está marcado como **extensión**.

## Cómo leer este documento

Cada sección indica qué responsable la implementa. Los responsables son los dueños de archivo del contrato:

| Responsable | Archivos | Secciones principales |
|---|---|---|
| SERVIDOR | `index.js` (solo cambios aditivos) | 9 |
| ARENA | `public/js/fx/particles.js`, `public/js/render/arena.js` | 2.3, 5 |
| LAYOUT | `public/index.html`, `public/css/theme.css` | 2, 3, 4, 6, 8 |
| ESCENAS | `public/js/ui/backdrop.js`, `public/js/ui/scenes.js` | 3, 4, 6 |
| INTEGRADOR | `public/SnakeGame.js` | 8, 10 |

Convenciones que valen para todo el documento:

- La arena mide W × H píxeles lógicos, el tamaño del mundo que manda el servidor (`canvasWidth` y `canvasHeight`): hoy 768 × 432 (16:9). En las fórmulas, `s` es `segmentSize` (hoy 12), y una medida como `0,5·s` significa 0,5 × `segmentSize` (con `s` igual a 12, son 6 px lógicos).
- Las coordenadas `x, y` de segmentos, comida, consumibles, proyectiles y eventos del servidor son la esquina superior izquierda de la celda. El centro es `(x + s/2, y + s/2)`.
- Las duraciones van siempre en milisegundos (ms). En los textos de interfaz, "s" significa segundos.
- "Escala de la arena" es `ancho CSS del canvas / W`. Con la arena de 600 px de ancho en pantalla vale 0,78.
- Los colores que no figuran como token se escriben en hex o `rgba()` explícito.

## 1. Concepto

La partida ocurre en el espacio profundo, lejos de cualquier estrella cercana. Casi todo es negro, y lo poco que se ve es luz: estrellas lejanas, el gas de una nebulosa y las criaturas que viven en el vacío. Cada serpiente es una de esas criaturas, hecha de gas luminoso: un núcleo casi blanco, un halo de su color que respira, estrellitas de cuatro puntas que titilan dentro del cuerpo y dos ojos. De la cola se le desprende un polvo fino que deriva y se apaga. La comida son planetas chicos con sus lunas; el escudo es una aurora; la boca grande, un agujero negro; el abanico, una estrella triple; los disparos, pulsos de luz con estela. Detrás de todo, una nebulosa tenue deriva muy despacio y las estrellas titilan casi quietas.

La interfaz cuenta un viaje que se aleja de un planeta. La intro empieza sobre su borde, con la atmósfera iluminada de costado; cada pantalla siguiente queda más lejos, hasta la sala y la partida, que ocurren en espacio profundo, sin planeta a la vista. Las superficies de la interfaz no brillan: son paneles oscuros, mate y translúcidos. La luz se reserva para lo que está vivo o espera una acción (el botón principal de cada escena, el jugador propio, el temporizador, una invitación). En los menús el ritmo es lento; en la partida es nítido; en los últimos diez segundos la nebulosa vira al rojo del hidrógeno y el pulso se acelera.

Las referencias salen de la astronomía real, sobre todo de las imágenes de Hubble y JWST: las nebulosas de emisión con sus tres colores (el rojo del hidrógeno alfa, el verde azulado del oxígeno y el dorado del azufre, la llamada paleta Hubble), las nubes de polvo marrón y ámbar con bandas oscuras como la Gran Grieta de la Vía Láctea, las estrellas coloreadas por su temperatura (del blanco azulado al naranja), el arco de choque de una magnetosfera y las auroras. Queda afuera el neón y el synthwave: el par magenta y cian, las grillas en perspectiva o de líneas, el sol retro, el cromado, las scanlines, los colores al 100 % de saturación y los bordes duros de un píxel que brillan. También quedan afuera la estética de tablero de nave espacial, las estrellas que pasan como en un salto a la velocidad de la luz, las mayúsculas sostenidas y todo lo que recuerde al mar: nada sube como una burbuja, nada flota ni se hunde.

Principios que ordenan todas las decisiones:

- **La luz es vida.** Solo emite luz lo que está vivo o lo que espera una acción. Fondos, paneles y textos de soporte son oscuros y quietos.
- **La distancia es progreso.** Cada escena queda más lejos del planeta que la anterior: menos luz de atmósfera, más contraste de las criaturas.
- **No hay gravedad.** Lo que se suelta (polvo, fragmentos, chispas) deriva y se apaga; nunca cae, sube ni se hunde.
- **Nada aparece en seco.** Toda entrada y salida de escena, overlay y toast se anima. Los elementos chicos que el código alterna con `.hidden` tienen animación de entrada (sección 4.20).
- **El movimiento responde.** La animación que no fue disparada por el usuario o por el juego se limita a la lista de la sección 3.5.

El momento firma es uno solo: **el vacío reacciona**. En intro, login, lobby y sala, el puntero (o el dedo) deja una estela de polvo estelar que se apaga en un segundo. En la arena de espera, cada criatura enciende las estrellas cerca de su cabeza. Durante la partida no: esos destellos del color de cada serpiente se confundían con la comida. Es la única "magia" ambiental; lo demás se mantiene sobrio para que esto se note.

## 2. Tokens de diseño

Responsable de declararlos: LAYOUT, en `theme.css`, bajo `:root`. ARENA y ESCENAS usan los mismos valores en canvas (copiados como constantes, porque el canvas no lee variables CSS en cada frame).

Varios nombres de token vienen del tema anterior, el abismo bioluminiscente, y se conservan para no tocar cada regla que los usa: `--bio-abyss-*` son las capas de vacío, `--bio-turquoise` es el verde azulado del oxígeno, `--bio-lime` es el dorado del azufre, `--bio-pearl` es la luz estelar y `--bio-deep-blue` es el azul de la atmósfera del planeta. Lo que vale es el valor y el uso de estas tablas, no el nombre.

### 2.1 Paleta

Los fondos son capas de vacío, casi negras y neutras, del más profundo al más elevado. El azul de atmósfera se usa solo en degradados y en la luz del planeta, nunca como relleno plano de un panel.

| Token | Hex | Uso |
|---|---|---|
| `--bio-abyss-950` | `#030307` | Viñeta, sombras, parte alta del cielo en la intro |
| `--bio-abyss-900` | `#07070D` | Fondo de página y de la arena (`body` lo declara explícito) |
| `--bio-abyss-800` | `#0C0C14` | Listas y zonas hundidas dentro de paneles |
| `--bio-abyss-700` | `#13131D` | Paneles, con alpha 0,86 |
| `--bio-abyss-600` | `#1C1C29` | Inputs, filas elevadas, hover de filas |
| `--bio-abyss-500` | `#2B2B3C` | Bordes fuertes, pips apagados, separadores |
| `--bio-deep-blue` | `#1D2A4F` | Atmósfera del planeta: degradados del fondo |
| `--bio-deep-blue-glow` | `#5A82C8` | Dispersión azul en el borde del planeta |

Las luces son los colores que emite una nebulosa. El verde azulado del oxígeno es la marca; el dorado del azufre es la acción; el rojo del hidrógeno, el peligro.

| Token | Hex | Uso |
|---|---|---|
| `--bio-turquoise` | `#5ED8C4` | Oxígeno: marca, foco, bordes activos, temporizador en calma |
| `--bio-turquoise-soft` | `#A8EADF` | Texto de acento, botones secundarios |
| `--bio-cyan` | `#8FB2FF` | Estrella azul: información |
| `--bio-lime` | `#EAC255` | Azufre: botón principal, éxito, "¡Ya!", jugador propio en listas |
| `--bio-lime-soft` | `#F6DC94` | Texto con tono dorado sobre oscuro |
| `--bio-pearl` | `#F6F3EE` | Luz estelar: títulos display, núcleos de luz |
| `--bio-shield` | `#C7B8FF` | Aurora: inmunidad, chispas del bloqueo, icono de escudo |

Estados y texto:

| Token | Hex | Uso |
|---|---|---|
| `--bio-warning` | `#F08A3C` | Temporizador entre 20 y 11 segundos, avisos |
| `--bio-danger` | `#EC4F5A` | Hidrógeno alfa: errores, tensión, temporizador desde 10 segundos |
| `--bio-danger-soft` | `#F59A9E` | Texto de error sobre `abyss-600` o más claro |
| `--bio-invite` | `#A595F2` | Invitaciones, modo espectador |
| `--bio-ink` | `#ECEAF1` | Texto principal |
| `--bio-ink-2` | `#ADAABB` | Texto secundario |
| `--bio-ink-3` | `#85829A` | Metadatos; prohibido sobre `abyss-500` |
| `--bio-ink-on-lime` | `#2B1D04` | Texto sobre botones dorados |
| `--bio-ink-on-turquoise` | `#082A25` | Texto sobre relleno verde azulado |
| `--bio-ink-on-invite` | `#160E3A` | Texto sobre relleno violeta |

`--bio-success` es un alias de `--bio-lime` y `--bio-info` es un alias de `--bio-cyan`. El dorado de acción y el naranja de aviso están a 0,131 de distancia OKLab, así que el botón principal no se confunde con el temporizador en alerta.

Contrastes medidos con la fórmula WCAG 2.1 (todos los pares de uso real superan 4,5:1):

| Par | Contraste |
|---|---|
| `ink` sobre `abyss-700` | 15,5:1 |
| `ink-2` sobre `abyss-700` | 8,1:1 |
| `ink-3` sobre `abyss-700` / `abyss-600` | 5,0:1 / 4,5:1 |
| `ink-3` sobre `abyss-500` | 3,7:1 (no usar) |
| `danger` sobre `abyss-700` / `abyss-500` | 5,1:1 / 3,9:1 (sobre 500 usar `danger-soft`, 6,6:1) |
| `invite` sobre `abyss-700` | 7,2:1 |
| `ink-on-lime` sobre `lime` | 9,6:1 |
| `ink-on-turquoise` sobre `turquoise` | 8,8:1 |

Los paneles son translúcidos sobre un fondo animado. Para que el contraste medido se sostenga, el alpha de un panel nunca baja de 0,86 y el fondo vivo no pone partículas de más de 2 px detrás de texto (las motas de polvo cercanas del fondo son desenfocadas y de alpha ≤ 0,12).

### 2.2 Glow

El brillo de la interfaz DOM se construye con `box-shadow` y `text-shadow`, nunca con `filter: blur()` sobre elementos grandes.

| Token | Valor |
|---|---|
| `--bio-glow-turquoise` | `rgba(94, 216, 196, 0.35)` |
| `--bio-glow-lime` | `rgba(234, 194, 85, 0.30)` |
| `--bio-glow-cyan` | `rgba(143, 178, 255, 0.30)` |
| `--bio-glow-danger` | `rgba(236, 79, 90, 0.35)` |
| `--bio-glow-invite` | `rgba(165, 149, 242, 0.35)` |
| `--bio-glow-pearl` | `rgba(246, 243, 238, 0.30)` |

Receta para un elemento que brilla: `box-shadow: 0 0 0 1px <color al 50 %>, 0 0 24px <glow>`. Los títulos display (36 px o más) brillan como una estrella vista de lejos: un resplandor ancho y tenue de luz estelar, sin aro de color pegado a la letra, porque ese aro es justo lo que hace que un título parezca un cartel de neón. Títulos de escena y de overlay: `text-shadow: 0 0 20px rgba(246, 243, 238, 0.10)`. El título de la intro y el wordmark del login suman un segundo resplandor de oxígeno más ancho (`0 0 90px rgba(94, 216, 196, 0.10)` y `0 0 64px rgba(94, 216, 196, 0.08)`). Los momentos de juego (número de la cuenta regresiva, "¡Ya!", nombre del campeón) sí llevan aro, en su propio color: `text-shadow: 0 0 2px <color al 60 %>, 0 0 18px <glow>, 0 0 72px <color al 20 %>`. Prohibido `text-shadow` con glow en texto de menos de 36 px: ensucia la lectura. En canvas el glow se hace con sprites (sección 5.3).

### 2.3 Colores de jugador

Responsable: ARENA implementa `Arena.bioColor(hex)` (**extensión**). ESCENAS e INTEGRADOR la usan para todo color de jugador en DOM. Nadie modifica el servidor.

El servidor asigna 16 colores fijos en orden (`index.js:37-41`): verde, magenta, cian, amarillo, rojo, violeta, menta, naranja y ocho variantes más. Son neones saturados, y los dos primeros después del verde forman justo el par magenta y cian que este tema prohíbe. Además, sobre `#07070D` el azul `#4040ff` da 3,3:1 y el violeta `#8040ff` 3,9:1, y varios pares son casi iguales: la distancia OKLab mínima entre los 16 es 0,045 (`#ff0080` contra `#ff4080`).

La decisión: el color del servidor es solo una clave. El cliente lo traduce a un equivalente curado, y todas las superficies (arena, HUD, listas, overlays, final) usan la versión traducida, de modo que el punto del marcador coincide con la criatura. Cada color de la tabla sale de un tono, una luminosidad y un croma en OKLCH, con croma entre 0,06 y 0,17 (ninguno al máximo): el magenta pasa a rosa y el cian a verde azulado. Con la tabla curada, la distancia mínima entre los primeros 8 colores (los que aparecen en partidas de hasta 8 jugadores) es 0,088 (`#00ffff` contra `#40ff80`), la mínima entre los 16 es 0,062 (`#ff4080` contra `#ff8080`), y el contraste mínimo contra el fondo de la arena es 6,0:1. Todos los `text` superan 12,7:1 sobre `abyss-700`.

```js
// Clave: color exacto que envía el servidor (minúsculas). slot = posición en PLAYER_COLORS.
const BIO_PLAYER = {
  '#00ff41': { slot: 0,  body: '#75D87A', core: '#EBFAEB', deep: '#133D17', text: '#BFE8BF' },
  '#ff0080': { slot: 1,  body: '#FA89A5', core: '#FFEFF3', deep: '#531E2D', text: '#FFC8D4' },
  '#00ffff': { slot: 2,  body: '#6AE2D4', core: '#E4FBF7', deep: '#003F38', text: '#A6EAE1' },
  '#ffff00': { slot: 3,  body: '#FAD957', core: '#FAF5E3', deep: '#403100', text: '#E9DBA6' },
  '#ff4040': { slot: 4,  body: '#E76348', core: '#FFF0EA', deep: '#542016', text: '#FFCBBD' },
  '#8040ff': { slot: 5,  body: '#AC8FF8', core: '#F6F2FF', deep: '#362957', text: '#DDD2FF' },
  '#40ff80': { slot: 6,  body: '#A3FAD4', core: '#E7FBF1', deep: '#003F28', text: '#B0EACF' },
  '#ff8040': { slot: 7,  body: '#FFA04E', core: '#FFF1E5', deep: '#502600', text: '#FFD0AE' },
  '#4080ff': { slot: 8,  body: '#76ACFC', core: '#EBF6FF', deep: '#17325B', text: '#BFDDFF' },
  '#ff40ff': { slot: 9,  body: '#DB9FDE', core: '#FEF0FF', deep: '#472349', text: '#F3CBF5' },
  '#80ff40': { slot: 10, body: '#C6E867', core: '#F2F8E6', deep: '#2C3900', text: '#D3E3AF' },
  '#ff4080': { slot: 11, body: '#FFBCC1', core: '#FFEFF0', deep: '#541E25', text: '#FFC9CC' },
  '#4040ff': { slot: 12, body: '#7E86EC', core: '#F1F4FF', deep: '#2A2D5B', text: '#CFD7FF' },
  '#ffff80': { slot: 13, body: '#FCF1AA', core: '#F9F6E3', deep: '#3D3300', text: '#E5DDA7' },
  '#80ffff': { slot: 14, body: '#C0FBFF', core: '#E3FAFD', deep: '#003D46', text: '#ACE7EE' },
  '#ff8080': { slot: 15, body: '#FFCDA9', core: '#FFF1E6', deep: '#512500', text: '#FFCFAF' },
};
```

La copia de respaldo de `scenes.js` (la que usa si `Arena` no cargó) tiene los mismos valores. Significado de cada campo:

- **body**: color del gas del cuerpo, del halo y del punto en listas.
- **core**: núcleo casi blanco teñido; filamento central, ojos, estrellitas del cuerpo.
- **deep**: tono oscuro; final de la cola y trazo de la cola desprendida.
- **text**: nombres sobre fondo oscuro (etiquetas en la arena, filas del HUD).
- **slot**: elige el patrón de estrellitas del cuerpo (sección 5.4), para que dos jugadores de color parecido se distingan también por forma.

`Arena.bioColor(hex)` normaliza a minúsculas y devuelve el objeto de la tabla (siempre el mismo objeto, sin crear uno nuevo por llamada). Para un color desconocido (el servidor hoy no puede enviarlo, ver `index.js:43-52`) calcula en HSL conservando el tono: body con saturación 100 % y luminosidad 68 %, core con luminosidad 95 %, deep con 22 %, text con 84 %, y slot igual a la suma de los códigos de caracteres del hex módulo 4. El resultado se cachea por hex.

### 2.4 Tipografía

Dos familias de Google Fonts cubren los tres roles pedidos (display, interfaz y cifras):

- **Display: Fraunces, solo itálica.** Es una serif variable con eje `SOFT` (redondea terminales) y `WONK` (inclina letras de forma irregular). Con SOFT 100 y WONK 1 las letras parecen blandas y orgánicas, como el cuerpo de gas de las criaturas; la itálica sugiere deriva. Con peso 200 a 340 los trazos son finos, y el resplandor de luz estelar (sección 2.2) los rodea sin cerrarlos con un contorno. Uso: título de la intro, wordmark, títulos de overlays, número de la cuenta regresiva, nombre del campeón, contador gigante de la arena. Nunca por debajo de 32 px (el corte cargado es el óptico de 144, que a tamaños chicos se vuelve frágil).
- **Interfaz: Recursive, con eje MONO en 0.** Sans humanista de lectura clara, con tildes y signos de apertura completos en el subset latino. Uso: todo el texto de interfaz, botones, listas, toasts, etiquetas de nombre en la arena.
- **Cifras: Recursive con `font-variation-settings: "MONO" 1`.** La misma familia en su variante monoespaciada. Así el temporizador, los puntajes y los códigos de sala no bailan al cambiar de dígito, y no hace falta una tercera descarga. Se usa solo para cifras que cambian en vivo y para el código de sala. Nunca para etiquetas de texto.

URL única, verificada (respuesta 200; el archivo latino de Fraunces pesa 42,7 KB y el de Recursive 72,6 KB):

```
https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@1,144,200..600,100,1&family=Recursive:wght,MONO@300..800,0..1&display=swap
```

LAYOUT la carga con `<link rel="preconnect">` a `fonts.googleapis.com` y `fonts.gstatic.com` y un `<link rel="stylesheet">` en el `<head>`. Pilas de respaldo: `"Fraunces", "Iowan Old Style", Georgia, serif` (con `font-style: italic`) y `"Recursive", "Segoe UI", system-ui, sans-serif`.

ARENA y ESCENAS dibujan texto en canvas con estas fuentes. Antes del primer dibujo esperan `document.fonts.load('italic 300 100px Fraunces')` y `document.fonts.load('600 16px Recursive')`; si fallan o tardan más de 1500 ms, dibujan con la pila de respaldo y regeneran los sprites de texto cuando la fuente llegue (evento `document.fonts.onloadingdone`).

Pesos: Recursive 400 en texto corrido, 500 en nombres, 600 en botones y títulos de panel, 700 en cifras. Fraunces 300 en display (respira entre 260 y 340 en la intro), 400 en títulos de overlay. Interletrado: Fraunces display `-0.01em`; Recursive `0`; código de sala `0.12em`. Sin `text-transform: uppercase` en ningún lugar: los textos van en mayúscula inicial.

### 2.5 Escala tipográfica

Escala clásica (12, 14, 16, 18, 21, 24, 36, 48, 72) más un display fluido. El texto de interfaz base es 16 px; nada interactivo baja de 14 px.

| Token | Tamaño / interlineado | Uso |
|---|---|---|
| `--bio-fs-12` | 12 / 16 px | Metadatos de sala, pie de página |
| `--bio-fs-14` | 14 / 20 px | Estados, captions, toasts en móvil |
| `--bio-fs-16` | 16 / 24 px | Texto base, filas de listas, toasts |
| `--bio-fs-18` | 18 / 26 px | Inputs, nombre en el chip de perfil |
| `--bio-fs-21` | 21 / 28 px | Títulos de panel (Recursive 600) |
| `--bio-fs-24` | 24 / 28 px | Cifra del temporizador del HUD (MONO) |
| `--bio-fs-36` | 36 / 40 px | Títulos de escena (Fraunces) |
| `--bio-fs-48` | 48 / 52 px | Títulos de overlay (Fraunces) |
| `--bio-fs-72` | 72 / 72 px | Wordmark de login, "¡Ya!" en móvil |
| `--bio-fs-display` | `clamp(72px, 15vw, 192px)` / 0,9 | Título de la intro |

Largo de línea máximo 64 caracteres en textos de ayuda.

### 2.6 Radios

Las formas son orgánicas, como las criaturas: los paneles principales usan radios asimétricos (el token conserva el nombre `membrane` del tema anterior). La jerarquía se lee en el radio; no todo lleva el mismo.

| Token | Valor | Uso |
|---|---|---|
| `--bio-radius-sm` | `8px` | Pips, chips chicos, badges |
| `--bio-radius-md` | `14px` | Inputs, selects, filas de lista |
| `--bio-radius-lg` | `22px` | Tarjetas secundarias, popover de perfil |
| `--bio-radius-membrane` | `28px 22px 30px 20px / 24px 30px 20px 28px` | Paneles principales: tarjeta de login, `#roomSelection`, `#gameInterface`, final, modal |
| `--bio-radius-toast` | `18px 22px 18px 22px` | Toasts |
| `--bio-radius-pill` | `999px` | Botones, chip de perfil |
| `--bio-radius-arena` | `12px` | Marco de la arena (máximo: más radio tapa celdas de las esquinas) |

### 2.7 Espaciado

Escala de base 4: `--bio-space-1` 4px, `-2` 8px, `-3` 12px, `-4` 16px, `-5` 24px, `-6` 32px, `-7` 48px, `-8` 64px, `-9` 96px. Margen lateral de página (`--bio-gutter`): 16px hasta 768px, 24px entre 769 y 1279, 32px desde 1280. Objetivo táctil mínimo 44 × 44 px.

### 2.8 Capas (z-index)

Valores relativos a `body`, salvo los marcados como locales a `.arena-stage` (que forma su propio contexto de apilado).

| Token | Valor | Elementos |
|---|---|---|
| `--bio-z-backdrop` | 0 | `#backdrop` |
| `--bio-z-scene` | 10 | `#scenes` y sus `.scene` |
| `--bio-z-hud` | 20 | `#hud` |
| `--bio-z-footer` | 25 | `#gameFooter` |
| `--bio-z-chrome` | 30 | `#topbar`, `#dock`, `#dockToggle` |
| `--bio-z-overlay` | 40 | `#overlay-countdown`, `#overlay-round` (locales a `.arena-stage`) |
| `--bio-z-roundend` | 50 | `#gameOverScreen` (local a `.arena-stage`) |
| `--bio-z-final` | 60 | `#finalScreen` |
| `--bio-z-modal` | 70 | `#leaderboardModal` |
| `--bio-z-toast` | 80 | `#toasts` |

### 2.9 Bloque de variables

Este bloque es la base de `theme.css`. Las curvas y duraciones se explican en la sección 3.

```css
:root {
  color-scheme: dark;
  /* vacío (los nombres --bio-abyss-* quedan del tema anterior) */
  --bio-abyss-950:#030307; --bio-abyss-900:#07070D; --bio-abyss-800:#0C0C14;
  --bio-abyss-700:#13131D; --bio-abyss-600:#1C1C29; --bio-abyss-500:#2B2B3C;
  --bio-deep-blue:#1D2A4F; --bio-deep-blue-glow:#5A82C8;
  --bio-panel: rgba(19, 19, 29, 0.86);
  --bio-panel-border: rgba(94, 216, 196, 0.16);
  /* luz */
  --bio-turquoise:#5ED8C4; --bio-turquoise-soft:#A8EADF; --bio-cyan:#8FB2FF;
  --bio-lime:#EAC255; --bio-lime-soft:#F6DC94; --bio-pearl:#F6F3EE; --bio-shield:#C7B8FF;
  /* estado */
  --bio-success:var(--bio-lime); --bio-info:var(--bio-cyan);
  --bio-warning:#F08A3C; --bio-danger:#EC4F5A; --bio-danger-soft:#F59A9E; --bio-invite:#A595F2;
  /* texto */
  --bio-ink:#ECEAF1; --bio-ink-2:#ADAABB; --bio-ink-3:#85829A;
  --bio-ink-on-lime:#2B1D04; --bio-ink-on-turquoise:#082A25; --bio-ink-on-invite:#160E3A;
  /* glow */
  --bio-glow-turquoise:rgba(94,216,196,.35); --bio-glow-lime:rgba(234,194,85,.30);
  --bio-glow-cyan:rgba(143,178,255,.30); --bio-glow-danger:rgba(236,79,90,.35);
  --bio-glow-invite:rgba(165,149,242,.35); --bio-glow-pearl:rgba(246,243,238,.30);
  /* tipografía */
  --bio-font-display:"Fraunces","Iowan Old Style",Georgia,serif;
  --bio-font-ui:"Recursive","Segoe UI",system-ui,sans-serif;
  --bio-fs-12:12px; --bio-fs-14:14px; --bio-fs-16:16px; --bio-fs-18:18px; --bio-fs-21:21px;
  --bio-fs-24:24px; --bio-fs-36:36px; --bio-fs-48:48px; --bio-fs-72:72px;
  --bio-fs-display:clamp(72px, 15vw, 192px);
  /* forma y espacio */
  --bio-radius-sm:8px; --bio-radius-md:14px; --bio-radius-lg:22px;
  --bio-radius-membrane:28px 22px 30px 20px / 24px 30px 20px 28px;
  --bio-radius-toast:18px 22px 18px 22px; --bio-radius-pill:999px; --bio-radius-arena:12px;
  --bio-space-1:4px; --bio-space-2:8px; --bio-space-3:12px; --bio-space-4:16px;
  --bio-space-5:24px; --bio-space-6:32px; --bio-space-7:48px; --bio-space-8:64px; --bio-space-9:96px;
  --bio-gutter:16px;
  /* movimiento */
  --bio-ease-out:cubic-bezier(0.16, 1, 0.3, 1);
  --bio-ease-in:cubic-bezier(0.5, 0, 0.75, 0);
  --bio-ease-in-out:cubic-bezier(0.37, 0, 0.63, 1);
  --bio-ease-standard:cubic-bezier(0.2, 0, 0, 1);
  --bio-ease-jelly:cubic-bezier(0.34, 1.56, 0.64, 1);
  --bio-ease-jelly-soft:cubic-bezier(0.34, 1.3, 0.64, 1);
  --bio-dur-press:90ms; --bio-dur-hover:180ms; --bio-dur-quick:240ms; --bio-dur-base:360ms;
  --bio-dur-panel:520ms; --bio-dur-scene-out:420ms; --bio-dur-scene-in:720ms;
  --bio-dur-mood:1200ms; --bio-dur-breath:3600ms; --bio-dur-breath-slow:6400ms; --bio-stagger:60ms;
  /* capas */
  --bio-z-backdrop:0; --bio-z-scene:10; --bio-z-hud:20; --bio-z-footer:25; --bio-z-chrome:30;
  --bio-z-overlay:40; --bio-z-roundend:50; --bio-z-final:60; --bio-z-modal:70; --bio-z-toast:80;
  /* arena */
  --arena-size: calc(100vw - 2 * var(--bio-gutter));
}
@media (min-width: 769px)  { :root { --bio-gutter:24px; } }
@media (min-width: 1280px) { :root { --bio-gutter:32px; } }
```

## 3. Movimiento

Responsables: ESCENAS (transiciones, overlays, toasts, HUD), ARENA (canvas), LAYOUT (estados hover, foco y animaciones CSS de entrada).

### 3.1 Principios

Todo se mueve como en el vacío: acelera rápido y frena largo, sin rebotes secos ni caídas. Las entradas usan `--bio-ease-out` (frenado largo, como algo que deriva hasta detenerse); las salidas usan `--bio-ease-in` (se aleja y se va); los cambios cíclicos usan `--bio-ease-in-out`. El rebote (`--bio-ease-jelly`) se reserva para cosas que "laten" una vez: números de cuenta regresiva, "¡Ya!", pips del HUD. Una salida dura entre la mitad y dos tercios de la entrada correspondiente. Las animaciones de entrada combinan opacidad, desplazamiento corto (12 a 36 px) y, en piezas grandes, un desenfoque que se aclara (de 6 a 10 px a 0), como algo que sube desde aguas turbias.

### 3.2 Curvas

| Token | cubic-bezier | Uso |
|---|---|---|
| `--bio-ease-out` | `0.16, 1, 0.3, 1` | Entradas de escena, paneles, overlays, filas |
| `--bio-ease-in` | `0.5, 0, 0.75, 0` | Salidas: escenas, toasts, overlays |
| `--bio-ease-in-out` | `0.37, 0, 0.63, 1` | Respiración, cambios de ambiente, morph del wordmark |
| `--bio-ease-standard` | `0.2, 0, 0, 1` | Hover, foco, reordenamiento del marcador |
| `--bio-ease-jelly` | `0.34, 1.56, 0.64, 1` | Latido único: cuenta regresiva, "¡Ya!", pips |
| `--bio-ease-jelly-soft` | `0.34, 1.3, 0.64, 1` | Entrada de toasts |

En canvas se usan las funciones equivalentes. ARENA y ESCENAS las implementan igual:

```js
const easeOutExpo   = t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeInQuart   = t => t * t * t * t;
const easeInOutSine = t => -(Math.cos(Math.PI * t) - 1) / 2;
const easeOutBack   = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const smoothstep    = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
```

### 3.3 Duraciones

| Token | ms | Uso |
|---|---|---|
| `--bio-dur-press` | 90 | Botón presionado (escala 0,97) |
| `--bio-dur-hover` | 180 | Hover y foco |
| `--bio-dur-quick` | 240 | Salidas chicas, colapso de toasts |
| `--bio-dur-base` | 360 | Entrada de toasts, revelado de elementos `.hidden` |
| `--bio-dur-panel` | 520 | HUD, paneles, modal |
| `--bio-dur-scene-out` | 420 | Salida de escena |
| `--bio-dur-scene-in` | 720 | Entrada de escena |
| `--bio-dur-mood` | 1200 | Cambio de ambiente del fondo vivo |
| `--bio-dur-breath` | 3600 | Ciclo de respiración del botón principal |
| `--bio-dur-breath-slow` | 6400 | Respiración del título de la intro y del borde de la arena |
| `--bio-stagger` | 60 | Retardo escalonado entre hijos (máximo 8 hijos escalonados; del noveno en adelante entran juntos) |

### 3.4 Interacción

- **Botón principal** (relleno dorado): hover sube 1 px y aumenta el glow de 0,25 a 0,40 en 180 ms; presionado escala a 0,97 en 90 ms; al soltar vuelve con `--bio-ease-jelly` en 240 ms.
- **Botón secundario** (borde verde azulado): hover rellena con `rgba(94,216,196,0.08)` y el borde pasa de alpha 0,45 a 0,8.
- **Foco visible** en todo elemento interactivo: `outline: 2px solid var(--bio-turquoise); outline-offset: 3px; box-shadow: 0 0 0 6px rgba(94,216,196,0.18)`. Solo con `:focus-visible`.
- **Filas de lista** (salas, jugadores en línea): hover cambia el fondo a `abyss-600` y enciende el punto de la fila (alpha 0,6 a 1) en 180 ms. Las filas no se desplazan ni escalan en hover.
- **Inputs**: foco cambia el borde a verde azulado y suma el anillo de foco. Error de validación: el borde pasa a `danger` y el input hace una ondulación horizontal de 3 px, 2 ciclos en 320 ms (omitida con movimiento reducido).

### 3.5 Animaciones en reposo permitidas

Solo estas animaciones corren sin que nadie las dispare. Todo lo demás está quieto hasta que algo ocurre.

- El fondo vivo (`#backdrop`) y la arena en modo atracción.
- La respiración del botón principal de la escena activa (un solo botón por escena): glow entre 0,18 y 0,32 en `--bio-dur-breath`, `--bio-ease-in-out`, alternado e infinito. Botones principales por escena: login `#joinButton`, lobby `#createRoomButton`, sala `#startGameButton` (solo cuando está visible), final `#backToMenuButton`.
- El título de la intro: peso entre 260 y 340 en `--bio-dur-breath-slow`.
- Los puntos de estado de jugadores en línea disponibles: opacidad entre 0,55 y 1, ciclo de 2400 a 4000 ms con desfase aleatorio por fila.
- El borde de la arena: alpha de las franjas de portal entre 0,08 y 0,12 en `--bio-dur-breath-slow`.
- El indicador de escudo del HUD mientras dura la inmunidad y el temporizador desde los 10 segundos.

### 3.6 Movimiento reducido

Con `prefers-reduced-motion: reduce` cada módulo aplica esta tabla. ESCENAS y ARENA leen la preferencia con `matchMedia` y escuchan sus cambios.

| Elemento | Normal | Reducido |
|---|---|---|
| Transición de escena | Transición estándar de 900 ms con desplazamiento y desenfoque | Fundido de opacidad de 200 ms |
| Intro | Secuencia de 2800 ms | Título y aviso con fundido de 400 ms |
| Sacudidas (`Arena.shake`) | Según el catálogo | Desactivadas |
| Destellos en la arena | Hasta alpha 0,7 | Alpha máximo 0,25 |
| Ondulación del cuerpo | Activa | Desactivada |
| Partículas por evento | 100 % | 50 % |
| Estela del puntero | Activa | Desactivada |
| Respiraciones en reposo | Activas | Desactivadas (valor medio fijo) |
| Cuenta regresiva y "¡Ya!" | Escala y desenfoque | Solo opacidad |
| Toasts | Desplazamiento y rebote suave | Solo opacidad, 200 ms |

## 4. Escenas y transiciones

### 4.1 Mapa

Hay seis escenas. Las de sala ('room') y partida ('game') comparten el contenedor `#scene-arena` y se distinguen por `data-mode`. Los overlays de cuenta regresiva e inicio viven dentro de la escena de partida. Hay una sola partida por inicio, sin rondas: al terminar, la sala vuelve a espera con los mismos jugadores.

```
                  sin sesión guardada
   intro ───────────────────────────────▶ login
     │                                      │ profileLoaded
     │ con sesión (profileLoaded)           ▼
     └────────────────────────────────▶  lobby ◀── Salir a las salas ── final
                                           │ roomCreated / roomJoined     ▲  │
                                           ▼                              │  │ Volver a la sala,
                                         room ──── gameStart ────▶ game ──┘  │ countdown
                                           ▲  ▲                     │ gameEnd │ (Jugar de nuevo)
                                           │  └ playing=false sin ──┘         │
                                           │    fin de partida                │
                                           └──────────────────────────────────┘
   lobby ── spectatingStarted ──▶ game (modo espectador)
   cualquier escena con sesión ── resetPlayerProfile / profileError ──▶ login
```

Eventos y llamadas a `Scenes.go` que hace INTEGRADOR:

| Disparador | Llamada | Notas |
|---|---|---|
| Arranque de la página | `Scenes.go('intro', { immediate: true })` | Antes de conectar |
| Sin perfil guardado | `Scenes.go('login')` | Queda en cola hasta que termine la intro |
| `profileLoaded` | `Scenes.go('lobby', { greeting: nombre })` | Si la intro sigue, queda en cola |
| `profileError`, cerrar sesión | `Scenes.go('login')` | |
| `roomCreated`, `roomJoined` | `Scenes.go('room')` | |
| `gameStart`, `spectatingStarted` | `Scenes.go('game')` | |
| `updatePlayers` con `playing=false` estando en 'game' y sin fin de partida pendiente | `Scenes.go('room')` | Caso "No quedan jugadores suficientes" |
| `gameEnd` | `Overlays.final(...)` a los 2000 ms | Llama a `Scenes.go('final')` internamente; antes, la arena se congela sobre el ganador |
| `countdown` estando en 'final' | `Scenes.go('room')` | El anfitrión tocó "Jugar de nuevo": todos vuelven a la arena para ver la cuenta |
| `#backToRoomButton` | `Scenes.go('room')` | La sala ya está en espera |
| `#backToMenuButton`, `#leaveRoomButton`, `backToMenuSuccess` | `Scenes.go('lobby')` | |

### 4.2 Motor de escenas

Responsable: ESCENAS (`scenes.js`). LAYOUT da los estilos estáticos de cada estado.

- `Scenes.go(name, opts)` con `name` en `'intro' | 'login' | 'lobby' | 'room' | 'game' | 'final'`. `opts.immediate` salta la animación (se usa solo al arrancar). `opts.greeting` (**extensión**) es el nombre para el saludo de la intro; `opts.color` (**extensión**) es el color del campeón para 'final'. Ir a la escena actual es un no-op, salvo 'room' y 'game', que cambian `data-mode` sin salir del contenedor.
- **Cola de la intro.** Mientras la intro no terminó y el usuario no la saltó, `go()` no navega: guarda el destino (el último pedido reemplaza al anterior). Al terminar la secuencia, si el destino es 'lobby' avanza solo a los 700 ms; si es 'login', espera una entrada del usuario. Cualquier tecla, clic o toque durante o después de la secuencia navega al destino en cola. Si todavía no hay destino (por ejemplo, el perfil guardado se está verificando), el aviso cambia a "Conectando…" y se navega en cuanto llega.
- `Scenes.current()` devuelve el nombre actual. `Scenes.onEnter(name, fn)` registra callbacks; se llaman cuando la entrada termina (no cuando empieza).
- **Estados.** Cada `.scene` tiene `data-state` en `hidden | entering | active | leaving`. CSS: `[data-state="hidden"] { display: none }`; los otros tres se muestran. `.hidden` no se usa nunca sobre contenedores de escena. La escena que sale recibe `inert` y `aria-hidden="true"` al empezar a salir; la que entra los pierde al empezar a entrar.
- **Atributos globales.** `body[data-scene]` refleja la escena actual (se actualiza al iniciar la transición). `#scene-arena[data-mode]` vale `room` o `game`. LAYOUT usa estos atributos para mostrar u ocultar el chrome (tabla siguiente).
- **Ambiente.** Al iniciar cada transición, Scenes llama a `Backdrop.setMood()` según el destino: la intro usa `intro`; login, `calm`; lobby, `lobby`; room, `room`; game, `game`; final, `celebration` con el color del campeón (o `lobby` si la sala se cerró con `reason`). El ambiente `tension` no lo pone Scenes sino INTEGRADOR (4.15).
- **Foco.** Al terminar la entrada, Scenes enfoca el elemento con `[data-autofocus]` de la escena; si no hay, el encabezado principal (con `tabindex="-1"`). Login enfoca `#username`; lobby enfoca `#createRoomButton`.
- **Implementación.** Las animaciones de escena, overlays y toasts se hacen con Web Animations API (`element.animate`), leyendo curvas y duraciones de las variables CSS una sola vez al iniciar. LAYOUT no define keyframes para escenas.

Visibilidad del chrome persistente según la escena (CSS de LAYOUT sobre `body[data-scene]`, con fundido de 300 ms):

| Elemento | intro / login | lobby / room | game / final |
|---|---|---|---|
| `#topbar` (wordmark y chip de perfil) | oculto | visible | oculto |
| `#dock` y `#dockToggle` | oculto | visible | oculto |
| `#gameFooter` | solo en login | visible | oculto |

### 4.3 Transición estándar: viaje

Toda transición entre escenas distintas usa esta coreografía, salvo las indicadas en 4.6 (salida de la intro), 4.11 (sala y partida) y 4.17 (entrada y salida del final). Cada cambio de escena es un tramo del viaje que se aleja del planeta (4.4). En `scenes.js` la hace `immerse()`, un nombre que viene del tema anterior.

1. La escena saliente pasa de opacidad 1 a 0, `translateY(0)` a `translateY(-28px)`, `scale(1)` a `scale(0.985)` y `blur(0)` a `blur(6px)`, en 420 ms con `--bio-ease-in`. Recibe `pointer-events: none` al empezar.
2. A los 180 ms de iniciada la salida, la escena entrante pasa de opacidad 0 a 1, `translateY(36px)` a 0, `scale(1.015)` a 1 y `blur(8px)` a 0, en 720 ms con `--bio-ease-out`.
3. Los hijos con `[data-stagger]` de la escena entrante entran escalonados: cada uno 60 ms después del anterior (del noveno en adelante, todos con el mismo retardo), desde `translateY(14px)` y opacidad 0, 560 ms con `--bio-ease-out`, empezando 120 ms después que la escena.
4. En el mismo instante del paso 1, el fondo vivo cambia de ambiente y recibe `Backdrop.pulse('#5ED8C4', 0.25)` (el `--bio-turquoise` de la marca) y `Backdrop.descend(dir)` (**extensión**; el nombre también viene del tema anterior: hoy empuja las estrellas). El orden del viaje es intro, login, lobby, room, game, final (`ORDER` en `scenes.js`). Si el destino está más adelante, `dir` vale 1 y las estrellas reciben un empuje hacia abajo: se siente que la cámara se aleja del planeta. Si está más atrás (de room a lobby, de lobby a login o del final a lobby), `dir` vale -1 y el empuje es hacia arriba: se vuelve hacia el planeta. El empuje arranca en 60 px/s, decae a 0 en 900 ms con `easeOutExpo` y se reparte por profundidad: × 0,35 en las estrellas lejanas, × 0,7 en las medias y × 1,6 en el polvo cercano (21, 42 y 96 px/s al empezar). Las estrellas solo se desplazan, sin estelas. Con movimiento reducido no hay empuje.

Duración total: 900 ms. El desenfoque se aplica solo a los contenedores de escena (no a la página entera) y con `will-change: transform, opacity, filter` puesto durante la transición y quitado al terminar.

### 4.4 Fondo vivo (Backdrop)

Responsable: ESCENAS (`backdrop.js`). Canvas `#backdrop` con `position: fixed; inset: 0`, `pointer-events: none`, detrás de todo.

El fondo cuenta un viaje que se aleja de un planeta. En la intro se ve grande el borde de su cara nocturna, con la atmósfera encendida; cada escena lo deja más lejos, más chico y más abajo, y en la sala y la partida ya no está: espacio profundo. Sobre el vacío hay una nebulosa tenue, la Vía Láctea y estrellas en tres profundidades.

Capas, de atrás hacia adelante:

1. **Vacío y cielo**: tres capas de color a pantalla completa. Primero, el color base del ambiente (tabla siguiente). Encima, el oscurecimiento hacia arriba: un degradado vertical de `#030307` con alpha 0,88 arriba, 0,6 al 30 % del alto, 0,15 al 62 % y 0 desde el 80 %, multiplicado por el factor de oscurecimiento del ambiente (`sky` en el código). Por último, el resplandor de la atmósfera: un degradado de `#2A3D6E` que sube desde el horizonte del planeta hasta 0,62 × el alto por encima de él, con alpha 0,42 en el horizonte, 0,32 al 88 % del tramo, 0,15 al 65 %, 0,04 al 35 % y 0 arriba; debajo del horizonte queda sólido al 0,42. Sigue la altura del planeta y se apaga con su alpha: en room y game el cielo queda casi parejo.
2. **Nebulosa**: textura de 200 × 125 generada al iniciar con ruido fractal: oxígeno verde azulado con filamentos arriba a la izquierda (centro en el 30 % del ancho y el 20 % del alto), polvo cálido con algo de H-alfa a la derecha (86 % y 42 %) y un velo índigo muy leve en todo el cielo. Es opaca (negro es nada) y se suma en modo `'lighter'` con el alpha de nebulosa del ambiente. Se escala hasta cubrir la pantalla sin deformarse, con un margen de × 1,24 (en un celular vertical se recorta a los lados), y deriva ±7 % del ancho y del alto en ciclos de 258 y 333 segundos.
3. **Vía Láctea**: banda diagonal que sube hacia la derecha con el 80 % del ángulo de la diagonal de la pantalla (unos 23° en 16:9), centrada en el 50 % del ancho y el 44 % del alto, con media anchura del 12 % de la diagonal y el bulbo más brillante arriba a la derecha del centro. Se prerenderiza en un canvas de la mitad del tamaño de la pantalla y no se estira: la banda y las estrellas mantienen su forma.
   - Brillo, polvo y bandas oscuras salen de ruido fractal estirado a lo largo de la banda, calculado en una grilla de 1/8 de la pantalla (mínimo 40 × 26) y escalado con suavizado. El brillo va de `rgb(146,158,204)` en los bordes a `rgb(218,184,138)` en el núcleo, con alpha hasta 0,34. Alrededor de las bandas oscuras hay polvo cálido `#8A5A3C` (alpha hasta 0,32), y las bandas oscuras son `rgb(4,4,9)` con alpha hasta 0,8.
   - Estrellas: una cada 1400 px² en toda la pantalla (tope de 1600, alpha 0,14 a 0,55) y una candidata cada 420 px² sobre la banda (tope de 3600, repartidas en gaussiana a lo ancho; cada una queda con probabilidad 0,25 más el brillo de la banda en ese punto, alpha 0,16 a 0,7). En 1920 × 1080 son unas 3100 (1480 de fondo y unas 1600 de la banda). Se escriben píxel a píxel con reparto bilineal; detrás de una banda oscura pierden hasta el 90 % (fondo) o el 95 % (banda) de su alpha. El 1,2 % son brillantes y se dibujan encima como sprite de estrella de 7 px con alpha × 1,6 (tope 0,85). Están infinitamente lejos: no derivan, no titilan y no tienen parallax.
   - Se dibuja con el alpha de Vía Láctea del ambiente.
4. **Estrellas en tres profundidades**. Lejanas y medias son un sprite con núcleo blanco y halo corto del color de su temperatura, dibujado a 7 × su tamaño. Colores por temperatura: 38 % blanco `#F4F3FF`, 26 % blanco azulado `#CFDBFF`, 14 % dorado pálido `#FFF2D6`, 9 % ámbar `#FFD9A8`, 4 % naranja `#FFB98A`, 4,5 % verde azulado `#A3D8CF` y 4,5 % rosa `#E8B6C8`.
   - **Lejanas**: 130 × la densidad del ambiente (tope 140), tamaño 0,55 a 1,0, alpha 0,3 a 0,7, titilan con amplitud 0,25 a 0,6 y período de 0,9 a 3,2 segundos, derivan hacia abajo a 0,8 a 1,6 px/s.
   - **Medias**: 46 × la densidad (tope 50), tamaño 1,0 a 1,8, alpha 0,35 a 0,75, titilan poco (0,1 a 0,25, de 2,5 a 6 segundos), derivan a 2,5 a 4,5 px/s. Las tres primeras son brillantes, con difracción de cuatro puntas cortas (sprite de 64 px dibujado a 13 × su tamaño con alpha × 0,55): tamaño 1,6 a 2,0, alpha 0,55 a 0,75, 60 % blanco azulado y el resto blanco.
   - **Polvo cercano** (se dibuja en la capa 7): 10 × la densidad (tope 12), motas desenfocadas de 5 a 14 px de radio, alpha 0,04 a 0,11 (siempre tenues, porque pasan detrás del texto), derivan a 7 a 12 px/s con un vaivén horizontal de ±4 px y período de 6 a 11 segundos. Color: 40 % dorado pálido, 30 % blanco azulado, 20 % ámbar y 10 % blanco.

   No suben: derivan despacio hacia abajo, más rápido cuanto más cerca, porque nos alejamos del planeta. La deriva se multiplica por la velocidad del ambiente; al salir por abajo, cada estrella reaparece arriba en una x al azar. Con `pointer: coarse` las cantidades se multiplican por 0,6 y los topes bajan a 80, 28 y 6. Las que sobran al bajar la densidad se apagan por orden, sin saltos. Las tres capas siguen al puntero con un parallax suave: de un borde de la pantalla al otro se corren 3, 9 y 26 px (en vertical, × 0,6). Lejanas y medias se dibujan detrás del planeta.
5. **Planeta**: abajo, con cara nocturna `#05060C`, una línea de atmósfera en el borde y la dispersión azul encima. El centro está en el 60 % del ancho (la curva cae más hacia la izquierda) y el radio es un factor del ambiente × el mayor entre el ancho y 1,25 × el alto.
   - La atmósfera es un degradado radial en unidades del radio, así que se afina al alejarse: nace sobre la cara al 0,99 del radio, en el borde es una línea clara `rgba(168,194,238,0.62)` y hacia afuera se desvanece en azul, de `rgb(90,130,200)` a `rgb(29,42,79)`, hasta 1,09 radios.
   - La estrella está detrás, a la derecha: una máscara horizontal deja el borde al 30 % de su brillo en el lado izquierdo de la pantalla, al 65 % en el centro y completo desde el 85 % del ancho.
   - Sobre la cara, junto al borde, nubes apenas visibles (textura de 256 × 48 en `rgb(30,38,58)`, alpha hasta 0,44) estiradas en horizontal, como vistas de canto.
   - Por ambiente, el planeta baja y se achica. En `intro`, el horizonte (su punto más alto) queda al 76 % del alto con radio 2,1; en `calm`, al 88,5 % con radio 1,3; en `lobby` es un arco al 95,5 % con radio 0,85 y alpha 0,95. En room, game, tension y celebration baja al 112 % con radio 0,6 y alpha 0, y deja de dibujarse.
   - Vive en un canvas propio del tamaño de la pantalla a media resolución, que se redibuja solo cuando cambia su geometría: durante las transiciones de ambiente (si el horizonte se movió más de 0,3 px o el radio más de 0,5 px) y después de un cambio de tamaño. El resto del tiempo es un `drawImage` con el alpha del ambiente.
6. **Siluetas lejanas** (dos en intro y calm, una en lobby): serpientes gigantes de gas oscuro, parientes de las del juego.
   - Forma: lomo de 36 puntos con el perfil de las serpientes de la arena (cabeza apenas redondeada, cuerpo casi parejo que se afina en la segunda mitad hasta una cola fina), de largo 50 a 72 % del ancho de la pantalla (300 a 1400 px) y grosor de 5,5 a 7 % del largo (20 a 84 px).
   - Cuerpo `rgb(5,5,11)` en tres capas cada vez más angostas (ancho × 1, × 0,74 y × 0,46 con alpha 0,2, 0,24 y 0,3): el borde es blando y lo de atrás se ve a medias.
   - Sobre el lado que mira al planeta, abajo, un borde de luz estelar `rgb(196,210,255)` en modo `'lighter'`: un trazo de 9 px y otro de 3,5 px, con alpha 0,04 y 0,05 en el primer tercio que bajan hacia la cola. Un ojo pálido cerca de la cabeza (alpha 0,6) y 13 estrellas adentro que titilan (alpha 0,5 ± 0,38, ciclo de unos 3,7 segundos).
   - Movimiento: cruzan la pantalla de lado a lado en 60 a 90 segundos, inclinadas hasta ±7°, una en la franja alta (8 a 22 % del alto, arriba del título de la intro) y otra en la baja (63 a 69 %, entre la bajada y el horizonte del planeta), al iniciar en sentidos opuestos. Ondulan con una onda fija a lo largo del cuerpo (amplitud de 2,5 a 5 % del lado menor de la pantalla más 10 px en la alta, hasta 3,5 % en la baja) y otra lenta que lo recorre (5 a 11 px, período de 14 a 22 segundos). Siguen el parallax de las estrellas lejanas al 60 %. Al terminar de cruzar, la siguiente espera fuera de pantalla entre el 5 y el 45 % de su recorrido.
7. **Polvo cercano**: la tercera profundidad de la capa 4, delante del planeta y de las siluetas.
8. **Criatura de la intro** (4.6), solo durante la secuencia completa.
9. **Estela del puntero** (el momento firma): con `pointermove` y `touchmove` (un `pointerdown` de toque o lápiz arranca el trazo en ese punto) se emite una partícula de polvo estelar cada 7 px de recorrido, hasta 4 por frame, con un desvío de ±5 px a los lados. Vida de 0,9 a 1,4 segundos, tamaño 0,9 a 2,0 (el 12 % son más grandes, de 2,2 a 3,0, con alpha 0,5), dibujadas como punto con halo a 6 × su tamaño que se achica un 35 % al morir. Colores: 60 % verde azulado `#5ED8C4`, 25 % dorado suave `#F6DC94` y 15 % dorado `#EAC255`. Sin gravedad: lo suelto deriva (arrastre de 0,95 por cada 16,7 ms) y se apaga (aparece en el primer 10 % de su vida y se desvanece con `easeInQuart`). Activa solo en intro, calm, lobby y room; apagada con movimiento reducido. Las partículas salen de un pool fijo de 100 (60 con `pointer: coarse`) que comparten la estela, el polvo de la criatura de la intro y las ráfagas de celebración; con el pool lleno, la nueva reemplaza a la más vieja.
10. **Pulsos**: `Backdrop.pulse(color, strength)` dibuja desde el centro de la pantalla un anillo de luz (sprite de degradado radial con alpha 0,22 en el centro, 0,5 al 55 %, pleno al 82 % y 0 en el borde) que crece de radio 0 a 0,9 × el lado mayor en 900 ms con `easeOutCubic`, con alpha `strength × 0,35` que baja a 0 con la curva `(1 - t)^1,3`, en modo `'lighter'`. `strength` se limita a 1,5. Máximo 3 pulsos simultáneos (el más viejo se descarta).
11. **Tensión** (solo en `tension`): nubes de hidrógeno H-alfa, una textura de 160 × 100 de ruido fractal en `rgb(226,62,78)` más densa hacia los bordes, sumada en modo `'lighter'` con alpha entre 0,18 y 0,42 que late a 1 Hz (`0,42 × (0,72 + 0,28 sen)`). Con movimiento reducido no late: queda en 0,85 del máximo.

Ambientes de `Backdrop.setMood(name, opts)`. `opts` es **extensión**: `opts.color` solo se usa en `celebration` (por defecto `#EAC255`). El cambio interpola todos los parámetros en 1200 ms con `easeInOutSine` (400 ms con movimiento reducido; colores interpolados en RGB), incluida la posición del planeta, que así baja y se achica a la vista. La frecuencia de cuadros y la resolución cambian en el acto. Pedir el ambiente actual no hace nada, salvo `celebration` con un color. En la tabla, Vía Láctea, nebulosa y oscurecimiento son los alphas de esas capas (0 cuando no se nombran) y la velocidad multiplica la deriva de las estrellas.

| Ambiente | Color base | Densidad / velocidad | Extras |
|---|---|---|---|
| `intro` | `#090B16` | 0,8 / 1,0 | Vía Láctea 0,75, nebulosa 0,55, oscurecimiento 1; planeta cercano; dos siluetas; estela |
| `calm` (login) | `#080A14` | 0,9 / 0,9 | Vía Láctea 0,62, nebulosa 0,6, oscurecimiento 0,9; planeta a media distancia; dos siluetas; estela |
| `lobby` | `#080912` | 1,0 / 1,0 | Vía Láctea 0,75, nebulosa 0,65, oscurecimiento 0,75; arco del planeta; una silueta; estela |
| `room` | `#07080F` | 0,85 / 0,9 | Vía Láctea 0,3, nebulosa 0,7, oscurecimiento 0,15; sin planeta; estela |
| `game` | `#06070D` | 0,5 / 0,7 | Vía Láctea 0,06, nebulosa 0,35; sin planeta, siluetas ni estela; 30 fps; resolución 0,35 |
| `tension` | `#10060A` | 0,5 / 1,3 | Vía Láctea 0,05, nebulosa 0,3; nubes H-alfa que laten a 1 Hz; 30 fps; resolución 0,35 |
| `celebration` | `#0A0C18` | 1,3 / 2,0 | Vía Láctea 0,5, nebulosa 0,75, oscurecimiento 0,2; 60 % de las estrellas medias y del polvo cercano en el color del campeón; 6 ráfagas en 3 segundos; a los 6 segundos baja a densidad 1,0 y velocidad 1,0 |

Ráfagas de `celebration`: una cada 500 ms desde los 250 ms, cada una en un punto al azar entre el 12 y el 88 % del ancho y el 16 y el 72 % del alto. Cada ráfaga es un destello local (tamaño 26, alpha 0,32, 750 ms) y 40 partículas en el color del campeón y perla `#F6F3EE` (una de cada tres), a 50 a 210 px/s, con vida de 1,1 a 2,0 segundos, tamaño 1,6 a 3,8 y sin gravedad.

Rendimiento del fondo vivo: el backing store mide la mitad del tamaño CSS (ignora `devicePixelRatio`; todo es suave y el escalado no se nota), 0,35 en `game` y `tension`, que además dibujan a 30 fps. El contexto se pide con `alpha: false`. Tope de 202 estrellas y motas en total (114 con `pointer: coarse`), más el pool de 100 partículas de efecto (60). No hay allocations por frame:

- La nebulosa, la capa H-alfa, las nubes del planeta, el sprite de difracción y los degradados del cielo y de la atmósfera se generan una vez al iniciar.
- La Vía Láctea se genera al iniciar y al cambiar de tamaño, pero solo si cambia el ancho o el alto cambia más de un 25 %: la barra de direcciones del celular, que aparece y se esconde, apenas la estira. Al regenerarla, las siluetas vuelven a empezar.
- El caché del planeta se ajusta en cada cambio de tamaño (es barato) y se redibuja solo cuando se mueve.
- El cambio de tamaño espera 100 ms sin eventos y reescala las posiciones de las estrellas.

Con `document.hidden` se cancela el `requestAnimationFrame`; al volver se reinicia el delta de tiempo (que además se limita a 50 ms) para que nada salte. Con movimiento reducido, la deriva de estrellas y nebulosa va al 15 %, las siluetas al 20 % y el titilar al 30 %; no hay estela ni empuje, las ráfagas tienen la mitad de partículas y los pulsos el 60 % del alpha. `Backdrop.stats()` (diagnóstico) devuelve `{ mood, fps, costMs, stars, fx, res, running, buildMs }`: `stars` son las estrellas y motas visibles de las tres profundidades (no cuenta la Vía Láctea), `fx` las partículas de efecto vivas, `costMs` el costo medio por frame y `buildMs` los milisegundos que tardaron en generarse las texturas fijas (`caches`) y la última Vía Láctea (`sky`).

### 4.5 Estructura del DOM

Responsable: LAYOUT. Este árbol fija la ubicación de cada ID del contrato. Los elementos que el JS genera se definen en 4.21. `#infoCanvas` y `#infoCanvasContainer` desaparecen (INTEGRADOR elimina sus referencias).

```
body[data-scene]
├─ canvas#backdrop
├─ header#topbar                       (extensión)
│  ├─ span.wordmark[data-wordmark-target]      "snake"
│  └─ div#profileView                  (chip + popover, ver 4.9)
│     ├─ button.profile-chip[aria-expanded]
│     └─ div.profile-popover
│        ├─ div#profileInfo
│        └─ div.profile-actions > #leaderboardButton, #resetProfileButton
├─ main#scenes
│  ├─ section#scene-intro.scene
│  │  ├─ h1.intro-title  "snake"
│  │  ├─ p.intro-tagline
│  │  └─ p.intro-prompt
│  ├─ section#scene-login.scene
│  │  └─ div.login-card
│  │     ├─ span.login-wordmark[data-wordmark-target]  "snake"
│  │     └─ div#loginView > label[for=username], input#username, p.field-help,
│  │                        #joinButton, #loginLeaderboardButton
│  ├─ section#scene-lobby.scene
│  │  └─ div#roomSelection.lobby-card
│  │     ├─ h2 "Salas"
│  │     ├─ #createRoomButton
│  │     ├─ div.join-by-code > label[for=roomId], input#roomId, #joinRoomButton
│  │     └─ div.rooms > h3, #refreshRoomsButton, ul#roomsList
│  └─ section#scene-arena.scene[data-mode="room"]
│     └─ div.arena-layout
│        ├─ aside.arena-side > div#gameInterface
│        │  ├─ div#spectatorBanner
│        │  ├─ div#roomInfo
│        │  ├─ h2.players-heading, ol#playerList
│        │  ├─ div#waitingSpan, button#startGameButton
│        │  ├─ div#configPanel > #toggleConfigButton, div#configSettings
│        │  │     (fieldset#difficultyPicker con tres label.difficulty-option, p.config-info)
│        │  └─ div.controls-hint[data-variant]
│        ├─ div#hud  (display: contents)
│        │  ├─ div.hud-bar
│        │  └─ div.hud-side > ol.hud-board, p.hud-board-caption
│        └─ div.arena-stage
│           ├─ div.arena-frame > canvas#game
│           ├─ div#overlay-countdown.overlay
│           ├─ div#overlay-round.overlay
│           └─ div#gameOverScreen.round-end > div.round-end-card > h2#roundEndTitle, div#scoreDisplay, #restartButton
├─ aside#dock > div#onlinePlayersPanel > h3, ul#onlinePlayersList     (extensión: #dock)
├─ button#dockToggle > span "En línea", span#dockCount                 (extensión)
├─ div#finalScreen.final-screen > div.final-content > h1#finalTitle, p#finalMessage,
│                                  section.final-scores > h2, ol#finalScoresList, #backToMenuButton
├─ div#leaderboardModal.modal > div.modal-content > header (h2, #closeLeaderboardModal),
│                                div.leaderboard-head, ul#leaderboardList, p.leaderboard-note
├─ div#toasts[role=region]
├─ footer#gameFooter
└─ scripts (orden del contrato)
```

Notas para LAYOUT:

- `#scenes` es `display: grid` y cada `.scene` ocupa `grid-area: 1 / 1`, así dos escenas se superponen durante la transición sin posicionamiento absoluto, y la página hace scroll normal si una escena es más alta que la pantalla.
- Se conservan los atributos que el JS actual usa: `#resetProfileButton` (sin `onclick` en línea: el listener lo pone SnakeGame.js, para que la CSP no tenga que permitir manejadores en línea), `maxlength` de `#username` (20) y `#roomId` (6), y los `value` de los radios de `#difficultyPicker` (`easy`, `medium` y `hard`, con `medium` marcado).
- `#roomId` usa cifras MONO, interletrado 0,12em y `text-transform: uppercase` (es un dato, no una etiqueta).
- `body` tiene `overflow-x: hidden` y fondo `--bio-abyss-900`.
- Iconos: SVG en línea, trazo de 1,75 px, extremos redondeados, `currentColor`, retícula de 20 px. Se necesitan: magnetosfera (escudo, símbolo `#i-medusa`), agujero negro (boca grande, `#i-anemona`), estrella triple (abanico, `#i-estrella`), planeta (comida, `#i-plankton`), ojo (espectador), actualizar, cerrar, chevron, corazón (pie), y los tres logos del pie que ya existen. Sin emojis en ningún lugar.

### 4.6 Intro

Propósito: abrir en órbita, junto al borde de un planeta, y mostrar en tres segundos de qué se trata. Layout: pantalla completa, todo centrado. Título `h1.intro-title` en Fraunces itálica a `--bio-fs-display`, color `--bio-pearl` con luz estelar: un resplandor ancho y tenue (`0 0 28px` perla al 16 % y `0 0 90px` verde azulado al 10 %), sin aro de color pegado a la letra. Debajo, a 16 px, `p.intro-tagline` en Recursive 18 px `--bio-ink-2`. `p.intro-prompt` a 18vh del borde inferior, Recursive 16 px `--bio-ink`, con el aviso "Pulsa cualquier tecla para entrar en órbita" (o "Toca la pantalla para entrar en órbita" con `pointer: coarse`).

Secuencia completa (2800 ms), coordinada por ESCENAS entre `scenes.js` y `backdrop.js`:

1. **0 ms.** Pantalla `#030307`. Fondo vivo sin estrellas, nebulosa ni Vía Láctea, con el planeta invisible en su posición de la intro. La estela del puntero ya funciona. Sin título.
2. **150 ms.** Un único punto perla `#F6F3EE` se enciende al 40 % del ancho y 55 % del alto: sube en 120 ms con el tamaño a × 1,8 (vuelve a × 1 en 300 ms), baja al 35 % en 900 ms y se apaga en 1600 ms más. Es el primer destello.
3. **400 a 1300 ms.** Una galaxia se enciende desde ese punto: 48 puntos en dos brazos espirales de 24 que dan 1,25 vueltas, de radio 18 a 400 px por la escala de la pantalla (`min(ancho, alto) / 900`, entre 0,45 y 1,3), achatados al 82 % en vertical y con ±10 px de azar. Cada punto se enciende con la misma curva del primero; el encendido avanza desde el centro a 0,45 × escala px por ms, más un azar de ±60 ms. El tercio interior de cada brazo es el núcleo cálido (60 % dorado pálido `#FFF2D6`, 40 % ámbar `#FFD9A8`); el resto toma los colores de temperatura de las estrellas (4.4). La galaxia queda detrás del planeta. A la vez, desde los 400 ms, el fondo pasa en 1200 ms al ambiente `intro` sin estrellas, Vía Láctea ni siluetas y con la nebulosa en 0,15: aparecen el color del vacío, el borde del planeta con su atmósfera y el resplandor que sube desde el horizonte.
4. **900 a 2100 ms.** Una criatura de gas de 12 segmentos (separados 16 px, de 18 px de ancho en la cabeza a 10 px en la cola) entra por la izquierda al 35 % del alto, avanza ondulando en una senoide (amplitud 40 px, longitud de onda 420 px) y sale por la derecha. Es pariente de las serpientes de la arena: halo verde azulado, tres capas de gas `rgba(94,216,196,0.30)` cada vez más angostas y densas con un núcleo más claro `rgba(214,246,240,0.20)`, estrellitas blancas que titilan adentro (una cada dos segmentos) y dos ojos perla `#F6F3EE` con pupila `#030307`. Deja polvo estelar sin gravedad detrás de la cola (60 % verde azulado `#5ED8C4`, 25 % dorado suave `#F6DC94`, 15 % perla) y del medio del cuerpo (verde azulado), que deriva y se apaga en 0,8 a 1,7 segundos. Se dibuja en `#backdrop`, delante del polvo cercano.
5. **1100 a 2200 ms.** El título se revela siguiendo a la criatura: `mask-image` con un degradado lineal de borde suave (30 % del ancho) cuya posición sigue la x de la cabeza menos 30 px (`Backdrop.introCreatureX()`, **extensión**) y nunca va más lento que el reloj: a los 1100 ms del revelado queda completo. A la vez, el peso pasa de 200 a 300, el interletrado de 0,08em a -0,01em y el resplandor de 0 a pleno, todo en 1100 ms con `--bio-ease-out`.
6. **2000 a 2500 ms.** La línea `p.intro-tagline` sube 10 px y aparece en 500 ms.
7. **2500 a 2800 ms.** Aparece `p.intro-prompt` con un fundido de 300 ms y, al terminar la secuencia, respira (opacidad entre 1 y 0,55, ciclo de 2400 ms con `--bio-ease-in-out`). Desde los 2400 ms, el fondo llega en 900 ms al ambiente `intro` completo: estrellas, Vía Láctea, nebulosa y las dos siluetas. Si hay saludo (`opts.greeting`), en lugar del aviso se muestra "Hola de nuevo, {nombre}" y se avanza solo a lobby a los 700 ms.

Una tecla, un clic o un toque durante la secuencia la salta: las animaciones terminan en su estado final y el fondo llega al ambiente `intro` completo en 500 ms.

Versión corta: si `sessionStorage` tiene `bio.introSeen = "1"` (se escribe al terminar la primera intro; leer y escribir dentro de `try/catch`), la intro dura 900 ms. El fondo pasa de negro al ambiente `intro` completo en 900 ms, planeta incluido; el título aparece con fundido y desenfoque de 8 px a 0 en 600 ms, `p.intro-tagline` sube a los 300 ms y el aviso aparece a los 600 ms, sin galaxia ni criatura. Con movimiento reducido: título, `p.intro-tagline` y aviso con fundido de 400 ms, y el fondo llega a `intro` en el mismo tiempo.

Salida de la intro: el wordmark viaja. Scenes mide el destino `[data-wordmark-target]` de la escena siguiente (`.login-wordmark` en login, `#topbar .wordmark` en lobby) y anima el título de la intro con FLIP (traslación y escala) hasta ese rectángulo en 800 ms con `--bio-ease-in-out`; en los últimos 200 ms el título se desvanece y el destino aparece. El resto de la intro (`p.intro-tagline` y el aviso) sale con la transición estándar (4.3). El fondo recibe el mismo pulso y el empuje hacia abajo: el viaje empieza a alejarse del planeta. Con movimiento reducido, la intro sale entera con la transición estándar.

### 4.7 Login

Propósito: pedir un nombre y nada más. Layout desktop y móvil: columna centrada de hasta 420 px de ancho, centrada verticalmente.

- `.login-wordmark`: Fraunces itálica 300 a 72 px (48 px por debajo de 480 px de ancho), `--bio-turquoise-soft` con glow. Debajo, Recursive 16 px `--bio-ink-2`: "Multijugador en tiempo real".
- `.login-card`: membrana (`--bio-panel`, borde 1 px `--bio-panel-border`, `--bio-radius-membrane`, padding 32 px; 24 px en móvil).
- `label[for=username]` Recursive 600 16 px; `#username` de 52 px de alto, 18 px; `p.field-help` 14 px `--bio-ink-3` debajo.
- `#joinButton`: botón principal lima de ancho completo, 52 px de alto, respira. Mientras se espera `profileLoaded` muestra "Entrando…" y queda deshabilitado (INTEGRADOR).
- `#loginLeaderboardButton`: botón silencioso (texto `--bio-ink-2`, subrayado en hover), centrado debajo.
- Enter dentro de `#username` dispara `#joinButton` (INTEGRADOR).

Entrada: transición estándar (4.3) con `[data-stagger]` en wordmark, tarjeta y botón secundario.

### 4.8 Lobby

Propósito: crear una sala o entrar a una. Layout desktop (1024 px o más): `#roomSelection` como membrana de hasta 640 px de ancho, centrada en el espacio libre a la izquierda del dock.

```
┌ #topbar ─ snake ───────────────────────────────────────── [chip de perfil] ┐
│                                                                            │
│      ┌ #roomSelection ──────────────────────────────┐   ┌ #dock ────────┐  │
│      │ Salas                                        │   │ En línea      │  │
│      │ [        Crear sala        ]  (principal)    │   │ · Ana  Invitar│  │
│      │ Código de sala  [ ABC123 ] [Unirse]          │   │ · Leo  Invitar│  │
│      │ Salas abiertas                  [Actualizar] │   │               │  │
│      │ ┌ room-item ──────────────────────────────┐  │   │               │  │
│      │ │ K3J9QZ  Anfitrión: Ana  ●●●○○○○○  Unirse│  │   │               │  │
│      │ └─────────────────────────────────────────┘  │   └───────────────┘  │
│      └──────────────────────────────────────────────┘                      │
└ #gameFooter ───────────────────────────────────────────────────────────────┘
```

- Título "Salas" en Fraunces 36 px.
- `#createRoomButton`: principal, ancho completo, 56 px, respira.
- Fila de código: `label`, `#roomId` (ancho 160 px, cifras MONO) y `#joinRoomButton` secundario.
- `#roomsList`: lista con scroll interno (máximo 50vh en desktop, sin máximo en móvil). Cada `.room-item` es una fila de 64 px con el código de sala en MONO 18 px, el anfitrión, una fila de pips de capacidad (un pip de 6 px por lugar: encendidos en turquesa los ocupados, apagados en `abyss-500` los libres) y el botón de acción. Las salas en juego llevan la insignia "En juego" con un punto coral que late y el botón "Mirar" en variante violeta.
- Lista vacía: texto centrado `--bio-ink-2` 16 px.
- La lista se actualiza sin parpadeo: INTEGRADOR pone `data-reveal` solo en las filas cuyo código no estaba en la lista anterior, así que únicamente esas entran con el revelado de 4.20. Las que desaparecen no se animan. Lo mismo vale para `#onlinePlayersList` (clave: `socketId`).

Móvil (768 px o menos): una columna con margen de 16 px, la tarjeta ocupa todo el ancho, la fila de código pasa a dos filas (input de ancho completo, botón debajo) y el dock queda como hoja inferior (4.9).

### 4.9 Dock persistente y chip de perfil

Responsables: LAYOUT (marcado y estilos), INTEGRADOR (contenido), ESCENAS (animación de apertura del popover y la hoja).

El panel de jugadores en línea y el perfil se ven en lobby y en sala, porque invitar se hace desde la sala.

**Chip de perfil (`#profileView` dentro de `#topbar`).** `#topbar` es una barra fija de 64 px (56 en móvil) sin fondo propio: el wordmark a la izquierda (Fraunces itálica 300, 32 px, luz estelar `--bio-pearl`) y el chip a la derecha. El chip es un `button.profile-chip` en forma de píldora de 44 px de alto con un orbe de 32 px (degradado radial de `--bio-turquoise` a `--bio-deep-blue`, inicial del nombre en Fraunces 18 px `--bio-ink-on-turquoise`), el nombre en Recursive 600 16 px y, en desktop, "{n} victorias" en 14 px `--bio-ink-3`. Clic o Enter abre `.profile-popover` (membrana `--bio-radius-lg`, 300 px, anclada debajo del chip): aparece con opacidad, `translateY(-8px)` a 0 y escala 0,98 a 1 en 360 ms con `--bio-ease-out`; Escape o clic afuera lo cierra en 240 ms. Contiene `#profileInfo` (estadísticas, ver 4.21) y `.profile-actions` con `#leaderboardButton` (secundario) y `#resetProfileButton` (silencioso, texto coral suave en hover). `aria-expanded` y `aria-controls` en el chip.

**Dock (`#dock` con `#onlinePlayersPanel`).**

- Desde 1280 px: columna fija a la derecha (`top: 80px; right: var(--bio-gutter); width: 280px; max-height: calc(100vh - 140px)`), membrana con scroll interno. `#dockToggle` oculto.
- Entre 769 y 1279 px: el dock se oculta y aparece `#dockToggle`, botón flotante abajo a la derecha (por encima del pie): píldora "En línea" con `#dockCount` (cantidad de filas de la lista, que INTEGRADOR actualiza). Al tocarlo, el dock entra como panel lateral derecho de 320 px desde `translateX(24px)` y opacidad 0 en 520 ms con `--bio-ease-out`, con una capa de fondo `rgba(3,3,7,0.5)` que cierra al tocarla.
- Hasta 768 px: igual, pero el dock es una hoja inferior de 60vh de alto, radio superior de 24 px, con una barra de agarre visual de 36 × 4 px, que entra desde `translateY(40px)`.
- Cuando llega una invitación con el dock cerrado, `#dockToggle` late una vez (escala 1,08 con `--bio-ease-jelly`) y su borde pasa a violeta durante 3 segundos.

### 4.10 Sala (room)

Propósito: esperar jugadores, configurar e invitar, con la arena ya viva. La arena muestra el modo atracción (5.15): cada jugador de la sala recorre la arena como criatura, con su nombre. Cuando alguien entra, su criatura eclosiona; cuando sale, se disuelve.

Layout desde 1280 px. La grilla `.arena-layout` tiene tres columnas: izquierda de 300 px, centro flexible y derecha de 280 px. En sala, la derecha queda vacía porque la ocupa el dock fijo.

```
┌ #topbar ─ snake ───────────────────────────────────────── [chip de perfil] ┐
│ ┌ #gameInterface ─────┐ ┌ .arena-stage ───────────────────┐ ┌ #dock ────┐ │
│ │ Sala K3J9QZ         │ │ ┌ canvas#game ────────────────┐ │ │ En línea  │ │
│ │ Eres el anfitrión   │ │ │   criaturas con nombre      │ │ │ ...       │ │
│ │ Jugadores  2 de 8   │ │ │   (modo atracción)          │ │ │ [Invitar] │ │
│ │ ol#playerList       │ │ │                             │ │ │           │ │
│ │ #waitingSpan        │ │ └─────────────────────────────┘ │ └───────────┘ │
│ │ [Iniciar partida]   │ └─────────────────────────────────┘               │
│ │ Configuración  ⌄    │                                                   │
│ │ .controls-hint      │                                                   │
│ └─────────────────────┘                                                   │
└───────────────────────────────────────────────────────────────────────────┘
```

- `#gameInterface` es una membrana con este orden: `#spectatorBanner` (oculto en sala), `#roomInfo`, título "Jugadores" con contador, `#playerList`, `#waitingSpan`, `#startGameButton`, `#leaveRoomButton` ("Salir de la sala", botón silencioso de ancho completo, visible en la sala fuera de la cuenta regresiva y oculto en modo game), `#configPanel`, `.controls-hint`.
- `#roomInfo`: código de sala en MONO 21 px verde azulado suave y, debajo, el rol ("Eres el anfitrión" o "Anfitrión: {nombre}") en 14 px `--bio-ink-2`.
- `#playerList`: filas de 40 px con rango, punto del color bio del jugador (10 px con glow de su color), nombre, etiqueta "Anfitrión" si corresponde y, durante la partida, el largo actual (en la sala, la columna de puntaje queda vacía). Fila propia (`.current-player`): borde izquierdo de 3 px lima y nombre en `--bio-lime-soft`.
- `#startGameButton`: principal, ancho completo, respira solo cuando está visible.
- `#configPanel`: acordeón. `#toggleConfigButton` es la fila cabecera (texto y chevron que rota 180° en 240 ms, con `aria-expanded`); `#configSettings` se despliega con el revelado de 4.20. Adentro, `#difficultyPicker` (leyenda "Nivel") apila tres opciones de al menos 48 px de alto: nombre en `--bio-ink` y una pista en `--bio-ink-2` a 14 px, con `--bio-radius-md` y fondo `rgba(12, 12, 20, 0.6)`. El radio nativo queda oculto pero recibe el foco, que se ve como el anillo turquesa de los campos. La opción marcada lleva borde turquesa y glow suave. El anfitrión cambia de nivel con un toque, sin botón de guardar: el servidor reparte el nivel a toda la sala. Los invitados ven las opciones deshabilitadas, con opacidad 0,6 y cursor `not-allowed`.
- `.controls-hint`: tres variantes por `data-variant` (`player`, `spectator`, `touch`), cada una un párrafo que LAYOUT muestra u oculta por CSS. Las teclas van en `<kbd>` (fondo `abyss-600`, borde inferior de 2 px `abyss-500`, `--bio-radius-sm`, cifras MONO). INTEGRADOR elige la variante: `spectator` si mira, `touch` si `matchMedia('(pointer: coarse)')` y no hay teclado conocido, `player` en el resto.

Entre 1024 y 1279 px: dos columnas (izquierda de 260 px y centro); dock como botón flotante. Entre 769 y 1023 px: una columna centrada de hasta 640 px, con la arena arriba y `#gameInterface` debajo en dos columnas internas (jugadores a la izquierda, configuración a la derecha). Hasta 768 px: una columna; arena arriba a ancho completo; debajo, `#gameInterface`. `#startGameButton` queda `position: sticky; bottom: 12px` para que el anfitrión lo alcance sin scroll.

Tamaño de la arena (`--arena-size`), igual en sala y en partida para no redimensionar el canvas al cambiar de modo:

| Ancho de ventana | `--arena-size` |
|---|---|
| Hasta 768 px | `min(calc(100vw - 32px), 600px)` |
| 769 a 1023 px | `clamp(320px, min(calc(100vw - 48px), calc(100svh - 240px)), 640px)` |
| 1024 a 1279 px | `clamp(320px, min(calc(100vw - 340px), calc(100svh - 200px)), 680px)` |
| Desde 1280 px | `clamp(320px, min(calc(100vw - 680px), calc(100svh - 200px)), 760px)` |

`.arena-frame` mide `--arena-size` de lado, tiene `--bio-radius-arena`, `overflow: hidden` y sombra `0 0 0 1px rgba(94,216,196,0.18), 0 0 48px rgba(94,216,196,0.10), 0 30px 80px rgba(0,0,0,0.6)`. El canvas ocupa el 100 % del marco; su backing store lo maneja ARENA. En partida, el glow sube a 0,16; con `#scene-arena[data-phase="tension"]` el borde pasa a `rgba(236,79,90,0.35)` en 600 ms.

### 4.11 De sala a partida

Disparador: `gameStart` o `spectatingStarted`. La sala se transforma en la partida sin salir del contenedor; dura 900 ms.

1. **0 ms.** El contenido de `#gameInterface` se desvanece (opacidad a 0, `translateX(-12px)`, 240 ms con `--bio-ease-in`). El dock sale hacia la derecha (`translateX(24px)`, opacidad 0, 360 ms). El chip de perfil y el pie se desvanecen. Fondo vivo a `game`.
2. **240 ms.** Con todo eso invisible, Scenes cambia `data-mode` a `game`. La grilla reubica `#gameInterface` (ver 4.12).
3. **240 a 760 ms.** `.hud-bar` entra desde `translateY(-16px)` y opacidad 0 en 520 ms con `--bio-ease-out`. `.hud-board` entra con sus filas escalonadas (60 ms).
4. **500 a 900 ms.** Si `#gameInterface` es visible en ese ancho, reaparece en su nueva columna con opacidad en 400 ms. El glow del marco de la arena sube.

El camino inverso (partida a sala) usa los mismos pasos en orden inverso.

### 4.12 Partida (game)

Propósito: la arena es la protagonista; todo lo demás se aparta. Desde 1280 px, la columna izquierda pasa a ser el marcador (`.hud-board`), el centro tiene `.hud-bar` sobre la arena y la columna derecha (libre porque el dock se ocultó) recibe `#gameInterface` reducido: solo `#spectatorBanner` (si corresponde), `#roomInfo` y `.controls-hint`.

```
┌───────────────────────────────────────────────────────────────────────────┐
│                ┌ .hud-bar ──────────────────────────────┐                 │
│ ┌ .hud-board ─┐│ Última en pie o…     (1:42)     Escudo │┌ #gameInterface┐│
│ │ 1 ● Ana  34 │└────────────────────────────────────────┘│ Sala K3J9QZ   ││
│ │ 2 ● Tú   21 │┌ canvas#game ───────────────────────────┐│ Flechas o WASD││
│ │ 3 ● Leo  12 ││                                        ││ Espacio       ││
│ │ Largo actual││                                        │└───────────────┘│
│ └─────────────┘│                                        │                 │
│                └────────────────────────────────────────┘                 │
└───────────────────────────────────────────────────────────────────────────┘
```

Grilla de `.arena-layout` según modo y ancho (áreas CSS):

| Ancho | Modo room | Modo game |
|---|---|---|
| Desde 1280 px | `"side stage ."` | `"board bar rail" "board stage rail"` |
| 1024 a 1279 px | `"side stage"` | `"board bar" "board stage"`; `#gameInterface` oculto |
| Hasta 1023 px | `"stage" "side"` | `"bar" "stage" "board"`; `#gameInterface` oculto |

`#hud` usa `display: contents` en todos los anchos para que `.hud-bar` (área `bar`) y `.hud-side` (área `board`) sean ítems de la grilla. En modo room, ambos llevan `display: none`. `.arena-side` se asigna al área `side` en room y `rail` en game. En partida, `#configPanel`, `#startGameButton`, `#waitingSpan` y `#playerList` no se muestran (el JS ya oculta los primeros; `#playerList` y su título se ocultan por CSS con `[data-mode="game"]`). Por debajo de 1024 px, el badge de espectador lo muestra el HUD.

En partida y con `pointer: coarse` la página no debe hacer scroll al tocar la arena: `.arena-frame` tiene `touch-action: none`.

**Mundo apaisado.** La arena mide 768 × 432 lógicos (16:9, 64 × 36 celdas de 12 px): llena las pantallas anchas y en el celular se juega en horizontal. `--arena-size` es el ancho y el alto sale de `--arena-aspect`.

**Tamaño en partida.** La tabla de 4.10 vale para la sala. En partida la arena crece hasta ocupar el espacio disponible (`theme.css`, sección 18): el ancho que entra, limitado por el alto por 16:9. El cambio se hace al empezar la cuenta regresiva, no al largar, y Scenes lo anima con un FLIP de 520 ms sobre `.arena-stage` mientras ARENA rehace el canvas al tamaño nuevo. Desde 1024 px: marcador a la izquierda y arena con el resto (el riel de la sala no se muestra). Hasta 1023 px: arena arriba y chips del marcador debajo. En horizontal con hasta 560 px de alto (celulares): arena al centro, aro del tiempo y largo propio a la izquierda, marcador a la derecha, con costados de al menos 96 px para los pulgares. El backing store del canvas tiene un tope de 2200 px de ancho.

**Controles táctiles.** `#touchControls`, fijo sobre la escena, visible para quien juega (no para quien mira) en pantallas táctiles desde la cuenta regresiva: joystick flotante que aparece donde se apoya el pulgar, en cualquier parte de la pantalla fuera del botón de disparo, sigue al dedo y en reposo queda tenue abajo a la izquierda; pide un rumbo absoluto. Botón de disparo de 88 px abajo a la derecha, con un área táctil 20 px más grande que el círculo, atenuado con menos de 2 segmentos. Mantenerlo apretado dispara en continuo, un pedido cada `shotCooldownMs` (5 por segundo), como la barra espaciadora. Respetan `env(safe-area-inset-*)`.

**Horizontal obligatorio en el celular.** Con `pointer: coarse` en vertical y la partida en pantalla, `#rotateHint` tapa todo con un teléfono que gira y "Gira el teléfono"; los controles táctiles no se muestran. Donde el navegador lo permite (Android), un botón pone pantalla completa y fija la orientación en horizontal.

### 4.13 Cuenta regresiva 3, 2, 1

Responsable: ESCENAS (`Overlays.countdown(n)`). `#overlay-countdown` cubre `.arena-frame` (`position: absolute; inset: 0`), `pointer-events: none`.

- Al primer número aparece un velo radial (`radial-gradient` de `rgba(3,3,7,0.55)` en el centro a `rgba(3,3,7,0.2)` en los bordes) con fundido de 300 ms. Arriba del número, la meta de la partida, "Gana la última en pie o la más larga" (`docs/GAMEPLAY_SPEC.md`, etapa 5), en Recursive 600 18 px `--bio-ink-2`.
- El número va en Fraunces itálica 300, tamaño `calc(var(--arena-size) * 0.42)`. Colores: 3 en `--bio-turquoise`, 2 en `--bio-cyan`, 1 en `--bio-lime`, con el glow de texto display.
- Cada número entra con escala 1,5 a 1, opacidad 0 a 1 y `blur(14px)` a 0 en 480 ms con `--bio-ease-out`. Detrás, un anillo (`span.countdown-ring`, borde de 2 px del mismo color) crece de 0,4 a 1,6 veces el tamaño del número mientras su opacidad baja de 0,6 a 0, en 900 ms.
- Cuando llega el número siguiente, el anterior sale con escala 1 a 0,7, opacidad a 0 y `blur(8px)` en 260 ms con `--bio-ease-in`, y el nuevo entra a la vez.
- Con cada número: `Backdrop.pulse('#5ED8C4', 0.2)`.

### 4.14 Inicio de la partida

Responsable: ESCENAS (`Overlays.roundStart()`) y ARENA (`Arena.onRoundStart()`), en el mismo instante (`gameStart`).

`#overlay-round` muestra "¡Ya!" en Fraunces itálica 400, `--bio-lime`, tamaño `calc(var(--arena-size) * 0.28)` (mínimo 72 px), y encima "Gana la última en pie o la más larga" en Recursive 600 18 px. El velo de la cuenta regresiva se va en 400 ms. "¡Ya!" entra con escala 0,8 a 1 con `--bio-ease-jelly` en 420 ms, se sostiene 380 ms y sale con opacidad a 0, escala 1,15 y `blur(10px)` en 380 ms. Total: 1180 ms. En la arena, la ola de inicio (5.12). `Backdrop.pulse('#EAC255', 0.35)`.

### 4.15 Últimos 10 segundos

Antes, a los 20 segundos, empieza el frenesí (`gameState.frenzy`, `docs/GAMEPLAY_SPEC.md`): la comida base sube un 50 % y aparece con la animación de 5.11, de a una por paso. INTEGRADOR muestra una vez el toast "Frenesí: más comida hasta el final" (info, 3 s) y llama a `Backdrop.pulse('#EAC255', 0.25)`; el temporizador ya está en la fase `warn`.

Disparador: `roundTimeLeft` llega a 10. Lo pinta cada responsable en lo suyo:

- **ARENA**: contador gigante (5.13), viñeta roja creciente y nebulosa que vira al rojo del hidrógeno.
- **ESCENAS (HUD)**: temporizador en `danger` con latido por segundo; `#scene-arena[data-phase="tension"]`.
- **ESCENAS (Backdrop)**: ambiente `tension` (INTEGRADOR llama a `Backdrop.setMood('tension')` al llegar a 10 y `Backdrop.pulse('#EC4F5A', 0.15)` en cada segundo).
- **LAYOUT**: borde rojo del marco de la arena con `[data-phase="tension"]`.

### 4.16 Fin de la partida

Responsables: ARENA (`Arena.onRoundEnd({ winnerId })`, con `winnerId` nulo si hay empate) e INTEGRADOR.

- **0 ms.** Llega `gameEnd` con `{ ranking: [{ id, name, color, length, eliminated? }], winners: [id], ending }` (`ending`: `'time'` o `'elimination'`). La arena congela el último estado y enfoca al ganador (5.14). El marcador del HUD conserva el resultado: la sala ya volvió a espera en el servidor y el `updatePlayers` que sigue trae las serpientes con largo 3, pero el HUD no se actualiza con eso.
- **2000 ms.** Entra el final (4.17).

No hay panel intermedio: la partida es una sola.

### 4.17 Final

Responsable: ESCENAS (`Overlays.final(data)`, con los datos de `gameEnd`; los colores salen de `ranking`). `#finalScreen` cubre la pantalla (`position: fixed; inset: 0`), fondo `rgba(3,3,7,0.6)`. Llama a `Scenes.go('final', { color })`, que pone el fondo vivo en `celebration` con el color `body` del campeón. `#finalScreen` no es un contenedor `.scene`: se muestra encima de `#scene-arena`, que queda debajo sin animarse.

- **0 ms.** El fondo de `#finalScreen` aparece en 600 ms.
- **300 ms.** `#finalTitle` muestra el nombre del ganador (si hay empate, "Empate", sin animación por letra) en Fraunces itálica 300, `clamp(48px, 9vw, 112px)`, color `body` de su color bio con glow, `text-wrap: balance`. Cada letra es un `span.final-letter` (creado con `textContent`) que sube 30 px desde `blur(10px)` y opacidad 0, 700 ms con `--bio-ease-out`, escalonadas a 40 ms. Después, el glow del nombre respira.
- **900 ms.** `#finalMessage` aparece subiendo 10 px. Dice "Última en pie, con {n} segmentos." si la partida terminó por eliminación y quedó una sola; "Gana con la serpiente más larga: {n} segmentos." si ganó una por largo; "{A} y {B} terminan con {n} segmentos." en un empate por largo; y "{A} y {B} caen a la vez." si las últimas quedaron fuera en el mismo paso.
- **1200 ms.** Las filas de `#finalScoresList` (primero las vivas por largo final, de mayor a menor, y después las que quedaron fuera, de la última en caer a la primera; en lugar del largo, "fuera") entran escalonadas a 90 ms desde `translateY(20px)`. Las ganadoras (`.is-champion`) tienen borde izquierdo de 3 px de su color, fondo teñido con ese color al 8 % y el rango en Fraunces.
- **1700 ms.** `#finalHint` aparece con fundido: a un invitado le dice "{anfitrión} puede iniciar otra partida"; al anfitrión, solo si faltan jugadores ("Falta 1 jugador para jugar de nuevo").
- **1800 ms.** `.final-actions` sube 10 px. Para el anfitrión: `#playAgainButton` ("Jugar de nuevo", principal, respira; deshabilitado si faltan jugadores), `#backToRoomButton` ("Volver a la sala", secundario) y `#backToMenuButton` ("Salir a las salas", silencioso). Para un invitado, lo mismo sin "Jugar de nuevo". Para un espectador, solo `#backToMenuButton` como principal, con el texto "Volver a las salas". El foco va al título, no a los botones: Espacio es la tecla de disparo.

"Jugar de nuevo" emite `startGame`: la sala ya está en espera con los mismos jugadores y el mismo nivel. Cuando llega la cuenta regresiva, quien siga en el final pasa a la sala (`Scenes.go('room')`) para verla. "Volver a la sala" sale del final sin salir de la sala; ahí el anfitrión puede cambiar el nivel o esperar a más gente.

Con `reason` (sala cerrada): `#finalTitle` es "Sala cerrada" en `--bio-ink`, sin animación por letra, el fondo vivo pasa a `lobby` (no `celebration`). Con movimiento reducido: todo con fundido de 300 ms. `#finalScreen` admite `backdrop-filter: blur(6px)` solo desde 769 px y sin `pointer: coarse`.

Salida del final a la sala o a la partida: `#finalScreen` se va con el mismo fundido y la arena queda activa. Salida a las salas (`Scenes.go('lobby')`): `#finalScreen` baja a opacidad 0 con `blur(6px)` en 420 ms con `--bio-ease-in` y luego recibe `.hidden`; `#scene-arena` pasa a `hidden` en ese mismo momento (está tapada y no necesita animación); el lobby entra con la transición estándar y el empuje del fondo hacia arriba, de vuelta hacia el planeta.

### 4.18 Modal de ranking

Responsables: LAYOUT (marcado), ESCENAS (`Overlays.open(el)` y `Overlays.close(el)`, **extensión**), INTEGRADOR (contenido).

`#leaderboardModal` cubre la pantalla con `rgba(3,3,7,0.72)`; `.modal-content` es una membrana de hasta 560 px y máximo 80vh con scroll interno. Apertura: fondo en 280 ms; tarjeta desde escala 0,96, `translateY(16px)` y opacidad 0 en 420 ms con `--bio-ease-out`; filas escalonadas a 40 ms (máximo 10). Cierre: tarjeta y fondo a opacidad 0 en 240 ms, luego `.hidden`. Cierran: `#closeLeaderboardModal` (botón de icono de 44 px con `aria-label="Cerrar"`), Escape y clic en el fondo. Foco atrapado dentro mientras está abierto; al cerrar vuelve al botón que lo abrió.

`.leaderboard-head` es una fila estática con las cabeceras de columna. Las tres primeras filas usan color de rango: primero `#F7D879`, segundo `#CFCCDA`, tercero `#FFB38A` (rango y borde izquierdo de 3 px). `p.leaderboard-note` explica el orden.

`Overlays.open(el)` y `Overlays.close(el)` sirven para cualquier elemento con clase `.modal`: quitan o ponen `.hidden` antes o después de animar.

### 4.19 Toasts

Responsable: ESCENAS (`Toasts.show(message, type, durationMs, opts)`). Contenedor `#toasts` con `role="region"` y `aria-label="Notificaciones"`.

- Posición: desde 769 px, arriba a la derecha (`top: 80px; right: var(--bio-gutter); width: 360px`); en partida baja a `top: 20px` porque `#topbar` no está. Hasta 768 px: arriba, a todo el ancho menos el margen.
- Máximo 3 visibles; si llega un cuarto, el más viejo sale antes de tiempo. El más nuevo queda arriba.
- Mensaje idéntico (mismo texto y tipo) dentro de 2000 ms: no se crea otro, se reinicia el tiempo del existente.
- Duración por defecto: 3000 ms; `error` 4500 ms; `invitation` 9000 ms. El parámetro explícito manda.
- Pieza: `.toast` con membrana (`rgba(12,12,20,0.92)`, borde de 1 px del color del tipo al 35 %, `--bio-radius-toast`, padding 12 px 14 px), un punto de 10 px del color del tipo con glow, el texto en Recursive 16 px (14 px en móvil) y, si hay `opts.actionLabel`, un botón píldora pequeño. Abajo, una barra de 2 px que se vacía durante la duración (color del tipo al 60 %) y se pausa con hover o foco.
- Colores: `info` azul estelar, `success` dorado, `error` rojo, `invitation` violeta (botón de acción con relleno violeta y texto `--bio-ink-on-invite`).
- Entrada: desde `translateY(-12px)`, escala 0,97, opacidad 0 y `blur(4px)` en 360 ms con `--bio-ease-jelly-soft`. Salida: opacidad 0, `translateX(16px)` (o `translateY(-8px)` en móvil) y `blur(4px)` en 240 ms con `--bio-ease-in`; después la altura colapsa en 200 ms con `--bio-ease-standard` para que los demás se acomoden sin salto.
- Accesibilidad: cada toast tiene `role="status"`, salvo `error`, que tiene `role="alert"`. El texto se pone con `textContent`; nunca `innerHTML`.
- Tipo `invitation`: además del toast, `Backdrop.pulse('#A595F2', 0.4)` y el latido de `#dockToggle` (4.9).

### 4.20 Elementos que alternan `.hidden`

El JS muestra y oculta con `.hidden` (`display: none`) varios elementos chicos: `#configPanel`, `#configSettings`, `#startGameButton`, `#waitingSpan`, `#spectatorBanner`, `#resetProfileButton`, filas nuevas de listas. Para que no aparezcan en seco, LAYOUT les pone `data-reveal` y define una animación CSS que corre cada vez que el elemento pasa a mostrarse:

```css
[data-reveal]:not(.hidden) { animation: bio-reveal var(--bio-dur-base) var(--bio-ease-out) both; }
@keyframes bio-reveal { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
```

La desaparición de estos elementos es inmediata: solo escenas, overlays, modal, popover, dock y toasts animan la salida.

### 4.21 Marcado generado por JavaScript

LAYOUT estiliza estas estructuras; quien las genera (indicado en cada una) las construye con `createElement` y `textContent`, y pone colores de jugador como variable CSS (`el.style.setProperty('--c', bio.body)`).

**HUD** (ESCENAS) dentro de `#hud`. LAYOUT deja en el HTML los contenedores vacíos `div.hud-bar` y `div.hud-side` (con `ol.hud-board` y `p.hud-board-caption` adentro); HUD crea lo demás:

```html
<div class="hud-bar">
  <div class="hud-goal">
    <span class="hud-goal-label">Última en pie o la más larga</span>
  </div>
  <div class="hud-timer" data-phase="calm">          <!-- calm | warn | tension -->
    <svg class="hud-timer-ring" viewBox="0 0 64 64" aria-hidden="true">
      <circle class="hud-timer-track" cx="32" cy="32" r="26"/>
      <circle class="hud-timer-cilia" cx="32" cy="32" r="29"/>
      <circle class="hud-timer-progress" cx="32" cy="32" r="26"/>
    </svg>
    <span class="hud-timer-value" aria-label="1 minuto y 42 segundos">1:42</span>
  </div>
  <div class="hud-status">
    <span class="hud-shield"><svg/>Escudo <b class="hud-shield-time">3,2 s</b><i class="hud-shield-bar" style="--p:.64"></i></span>
    <span class="hud-spectator"><svg/>Espectador</span>
  </div>
</div>
<div class="hud-side">
  <ol class="hud-board" data-metric="live">        <!-- live | total -->
    <li class="hud-row is-me is-immune" data-id="socketId" style="--c:#7DFF6A; --t:#ABECA1; --w:.62">
      <span class="hud-rank">2</span><i class="hud-dot"></i><span class="hud-name">Ana</span>
      <span class="hud-me-tag">Tú</span><svg class="hud-immune-icon"/>
      <span class="hud-score">21</span>
      <i class="hud-len"></i>
    </li>
  </ol>
  <p class="hud-board-caption">Largo actual</p>
</div>
```

`.is-out` marca una fila con `gameover`. `--c` es el `body`, `--t` el `text` y `--w` la proporción del largo respecto del líder.

**Toast** (ESCENAS) dentro de `#toasts`:

```html
<div class="toast" data-type="invitation" role="status">
  <i class="toast-dot"></i><p class="toast-text">Ana te invita a la sala K3J9QZ</p>
  <button class="toast-action" type="button">Unirse</button>
  <i class="toast-progress" style="--d:9000ms"></i>
</div>
```

**Overlays** (LAYOUT da los contenedores; ESCENAS llena el texto): `#overlay-countdown` contiene `p.overlay-kicker`, `span.countdown-ring` y `span.countdown-number`; `#overlay-round` contiene `p.overlay-kicker` y `p.round-go`.

**Final** (ESCENAS) en `#finalScoresList`: `li.final-score-item` (más `.is-champion` en cada ganadora) con `--c`, y dentro `span.final-rank`, `i.final-dot`, `span.final-name` y `span.final-total` ("{n} segmentos"). Debajo de la lista, LAYOUT deja `p#finalHint` y `div.final-actions` con los tres botones de 4.17.

**Salas** (INTEGRADOR) en `#roomsList`. Sin `onclick` en línea: delegación de eventos sobre la lista con `data-room-id` y `data-action`.

```html
<li class="room-item" data-state="open">              <!-- open | playing | full -->
  <div class="room-info">
    <span class="room-code">K3J9QZ</span>
    <span class="room-live">En juego</span>            <!-- solo en playing -->
    <span class="room-host">Anfitrión: Ana</span>
    <span class="room-capacity" aria-label="3 de 8 jugadores"><i class="is-on"></i><i class="is-on"></i><i class="is-on"></i><i></i>…</span>
    <span class="room-config">Partida de 2 min, nivel medio</span>
  </div>
  <button class="join-room-btn" data-room-id="K3J9QZ" data-action="join">Unirse</button>
  <!-- playing: <button class="join-room-btn is-spectate" data-action="spectate">Mirar</button> ; full: <span class="room-full">Llena</span> -->
</li>
```

Estado vacío: `li.empty-room` con el texto de la sección 8.

**Jugadores de la sala** (INTEGRADOR) en `#playerList`: `li.player-item` (más `.current-player`, `.eliminated`) con `--c`, y dentro `span.player-rank`, `i.player-dot`, `span.player-name`, `span.player-host` (solo el anfitrión), `span.player-score` (el largo durante la partida; vacío en la sala) y `span.player-status` (icono de escudo `#i-medusa` con `aria-label="Con escudo"` si tiene inmunidad; vacío si no).

**Jugadores en línea** (INTEGRADOR) en `#onlinePlayersList`: la estructura actual (`li.online-player-item` > `div.online-player-info` > `div.online-player-name` y `div.online-player-status` con `.available` o `.in-game`; `button.invite-button`) más un `i.online-dot` al principio del `li`. Tras invitar, el botón queda deshabilitado con el texto "Enviada" durante 8 segundos. Vacío: `li.online-players-empty`.

**Perfil** (INTEGRADOR): el chip lleva `i.profile-orb` (inicial), `span.profile-chip-name` y `span.profile-chip-meta`. `#profileInfo` contiene:

```html
<div class="profile-stats">
  <strong class="profile-name">Ana</strong>
  <dl class="profile-grid">
    <div><dt>Partidas</dt><dd>12</dd></div><div><dt>Victorias</dt><dd>5</dd></div>
    <div><dt>Racha actual</dt><dd>2</dd></div><div><dt>Mejor puntaje</dt><dd>48</dd></div>
  </dl>
</div>
```

Los `dd` usan cifras MONO 21 px; los `dt`, 14 px `--bio-ink-3`.

**Ranking** (INTEGRADOR) en `#leaderboardList`: `li.leaderboard-item` con `span.rank`, `span.name`, `span.wins`, `span.games`, `span.winrate`, en ese orden. Mientras carga, `li.leaderboard-item.loading`. Cifras en MONO.

## 5. Arte de la arena

Responsable: ARENA. Todo lo de esta sección se dibuja en `canvas#game` con coordenadas lógicas de W × H, el tamaño del mundo que manda el servidor (`canvasWidth` y `canvasHeight`, por `Arena.setConfig`): hoy 768 × 432 (16:9), con `s` igual a 12. La arena es un pedazo de espacio profundo: nebulosa tenue, estrellas que titilan, criaturas del vacío con cuerpo de gas y planetas con lunas como comida. Ningún efecto tiene gravedad: nada flota ni se hunde.

### 5.1 Orden de capas

Cada frame de `Arena.render` dibuja, en este orden:

1. Sacudida: si hay una activa (5.12), se rellena el canvas con `#07070D` y las capas 2 a 12 se dibujan desplazadas.
2. Fondo del vacío y banda galáctica (caché).
3. Polvo de estrellas lejanas, en la misma caché. En calidad Q0 la caché también lleva la nebulosa quieta, entre la banda y el polvo.
4. Nebulosa (dos capas de patrón, aditivas).
5. Estrellas cercanas (campo propio de la arena).
6. Contador gigante, solo en los últimos 10 segundos (va debajo de todo lo jugable para no taparlo). Justo encima, y todavía debajo de lo jugable, la nova del ganador (5.14).
7. Comida (planetas).
8. Consumibles.
9. Estelas de proyectiles y proyectiles, y encima las colas desprendidas por los impactos.
10. Criaturas, en pasadas: halos de todas, velo de inmunidad, alcance de la boca grande, cuerpos, gas, estrellas internas, cabezas (5.4). La serpiente propia va última en cada pasada. Encima, la corona (5.6).
11. Partículas (`Particles`), y encima los efectos propios de la arena: anillos, destellos, la ola de inicio, la bocanada del disparo y la estela de la boca grande.
12. Etiquetas de nombre y textos flotantes.
13. Ya sin sacudida: destellos de portal y resplandor de los bordes.
14. Viñeta, y viñeta roja de tensión encima.

### 5.2 Fondo, nebulosa, estrellas, viñeta y bordes

El fondo tiene tres planos: una caché quieta con la banda galáctica y el polvo de estrellas, la nebulosa que deriva y un campo de estrellas cercanas que titilan.

- **Fondo del vacío** (caché a resolución del backing store; se regenera al cambiar el tamaño, al cambiar `s` y, en Q0, cuando termina de generarse la nebulosa): relleno `#07070D` (`--bio-abyss-900`). **Banda galáctica**: un degradado radial centrado en (0,52·W, 0,46·H), girado -0,38 rad y aplastado a 0,26 en vertical, de radio 0,62·W, con paradas `rgba(34,30,48,0.55)` en 0, `rgba(24,22,36,0.32)` en 0,5 y transparente en 1. Apenas se distingue del negro.
- **Polvo de estrellas lejanas** (misma caché): `W × H / 2300` puntos (144 en 768 × 432), de radio 0,3 a 0,75 px y alpha 0,18 a 0,56, fijos y sin brillo propio. Salen de un generador con semilla fija, así que no cambian al redimensionar. El 35 % se reparte cerca de la banda (hasta ±0,55·W a lo largo y una suma de tres sorteos por 0,16·H a lo ancho); los que caen afuera de la arena se descartan.
- **Nebulosa** (`drawNebula`): una textura de 256 × 256 de ruido fBm de valor, periódico para que se repita sin costura (red de período 3 en la primera octava, que se duplica en cada una), con el dominio deformado ±0,12 por dos fBm de 4 octavas para que las nubes tengan hebras y huecos oscuros. Por píxel: la densidad `d` es un fBm de 5 octavas sobre el dominio deformado; la nube es `smoothstep(0,46, 0,78, d)`; las hebras son la cresta de otro fBm (`1 - |2·fBm - 1|`) a la sexta, solo donde `d` pasa de 0,34 a 0,6; el alpha es `0,85 × nube^1,5 + 0,55 × hebras`, con tope 1. Tono: polvo cálido `#C98A4B` de base, oxígeno `#5ED8C4` en las regiones que marca un tercer ruido, núcleos dorados `#EAC255` (mezcla del 55 %) donde `d` pasa de 0,66 a 0,84, y hebras que tiran un 30 % al blanco estelar `#F6F3EE`. Se guardan dos copias: calma y tensión, la misma nube en rojo H-alfa `#EC4F5A` con bordes que tiran a `#F08A3C`.
- **Generación de la nebulosa**: no traba la carga. Se calcula de a 16 filas por frame (16 frames en total) y, al terminar, aparece con un fundido de 1500 ms.
- **Nebulosa por frame**: dos capas de `createPattern` con matriz, en `'lighter'`. Capa A: escala 3 (la textura cubre 768 px, el ancho de la arena), sin giro, alpha 0,17 y deriva de (0,8; 0,3) px/s. Capa B: escala 4,4, girada 2,2 rad para esconder que es la misma textura, alpha 0,11 y deriva de (0,45; 0,2) px/s. Las dos van a menos de 1 px/s y su cruce hace que la forma cambie despacio. **En tensión**, la copia roja entra con peso `0,9 × nivel de tensión` (y alpha × 1,3) y la de calma baja en la misma medida; la deriva se multiplica por `1 + 0,5 × tensión`. En renderIdle el alpha baja al 70 %. Con movimiento reducido no deriva. En Q1 se dibuja solo la capa A. En Q0 no se dibuja por frame: una copia quieta de la capa A en calma queda horneada en el fondo, sin deriva ni tinte rojo. Con `prefers-contrast: more` no hay nebulosa.
- **Estrellas cercanas** (`updateStars`, `drawStars`): 80 estrellas (50 en Q1, 28 en Q0; × 0,6 con `pointer: coarse`). Cada una tiene profundidad `z = 0,3 + 0,7 × azar²` (pocas cercanas y brillantes), color de la tabla de temperaturas y un titileo propio con período de 1,8 a 6 segundos que baja su brillo entre un 25 y un 75 %. Derivan hacia la derecha y apenas hacia abajo, más rápido las cercanas (paralaje): `0,5 + 1,8·z²` px/s en x (hasta 2,3) y `0,2 + 0,7·z²` px/s en y. Reaparecen por el borde opuesto. No suben ni flotan. Con `zz = (z - 0,3) / 0,7`, el tamaño base es `0,55 + 1,1·zz` px y el alpha `0,24 + 0,6·zz`, por el titileo. Las de `zz` mayor a 0,8 llevan rayos de difracción (sprite de estrella de radio `tamaño × (3,6 + 1,4 × titileo)`); las demás son un punto de glow de radio `2,4 × tamaño`. Todo en `'lighter'`. **Durante la partida** (`Arena.render`) se dibujan al 75 % de tamaño y al 60 % de alpha, y no se encienden: son fondo y no compiten con la comida ni con los consumibles. Con movimiento reducido no derivan y el titileo baja al 30 %.
- **Encendido**, solo en la arena de espera (`renderIdle`): si una estrella está a menos de `3·s_idle` de la cabeza de una criatura, o a menos de 46 px del puntero (si se movió en los últimos 900 ms a más de 40 px/s; nunca con movimiento reducido), su encendido sube a 1 y toma el color de esa criatura (el puntero usa el del slot cian, `#6AE2D4`). El encendido decae en 900 ms. Encendida, suma un glow `body` de radio `6 × tamaño` (alpha 0,7) y una estrella `core` de radio `3,4 × tamaño` (alpha 0,8), y su punto propio baja un 40 %. En partida las cabezas no encienden estrellas: esos destellos de color se confundían con comida. El costo es de 80 × criaturas comparaciones de distancia por frame.
- **Viñeta**: un cuadrado cacheado de 300 px estirado a la arena, transparente hasta el 55 % de la semidiagonal y `rgba(3,3,7,0.75)` en las esquinas. **Viñeta de tensión**: otra caché igual con `rgba(236,79,90,0.16)`, dibujada con alpha igual al nivel de tensión (`(10 - roundTimeLeft) / 10` cuando quedan 10 segundos o menos, suavizado en unos 300 ms), más un golpe de +0,25 en cada cambio de segundo que decae en 400 ms.
- **Bordes**: los bordes de la arena son portales. Cuatro franjas cacheadas de 14 px con un degradado de `#5ED8C4` hacia adentro (alpha 1, 0,35 al 35 % y 0 al final), dibujadas en `'lighter'` con alpha entre 0,08 y 0,12 en `--bio-dur-breath-slow` (0,10 fijo con movimiento reducido). Cuando una serpiente cruza, el borde se enciende en su color en un tramo de `6·s` centrado en el cruce, con un glow de 28 px de alto sobre la línea del borde, durante 600 ms.

Las estrellas, lejanas y cercanas, toman el color de esta tabla (`STAR_COLORS`), sorteado con estos pesos:

| Color | Tipo | Peso |
|---|---|---|
| `#CFDBFF` | Azulada | 16 % |
| `#F4F3FF` | Blanca | 34 % |
| `#FFF2D6` | Amarilla | 27 % |
| `#FFD9A8` | Naranja clara | 15 % |
| `#FFB98A` | Naranja | 8 % |

### 5.3 Sprites y cachés

No se usa `shadowBlur` en ningún dibujo por frame. Todo brillo sale de sprites prerenderizados dibujados con `globalCompositeOperation = 'lighter'`.

- **Sprite de glow** (`Particles.glowSprite`): canvas fuera de pantalla de 64 × 64 (o 128 × 128 para radios mayores a 24 px lógicos) con un degradado radial: color al 100 % en 0, al 45 % en 0,25, al 12 % en 0,55 y 0 en 1. Clave de caché: `color + '|' + tamaño`. Máximo 64 entradas (la más vieja se descarta).
- **Mancha de gas** (`softSprite`): 64 × 64, con un perfil ancho y sin pico (100 % en 0, 85 % en 0,3, 40 % en 0,6, 8 % en 0,85 y 0 en 1), para que una cadena de manchas a lo largo del cuerpo se vea continua y no como cuentas. Una por color.
- **Estrella de 4 puntas** (`starSprite`): 64 × 64, con un halo radial hasta la mitad del radio (90 %, 40 % en 0,2, 8 % en 0,55 y 0), dos rayos de difracción en cruz que se afinan desde 2,2 px de semiancho en el centro hasta los bordes del sprite y se apagan (100 %, 45 % en 0,25, 6 % en 0,7 y 0), y un núcleo blanco de 5 px de radio. Una por color. La usan las estrellas internas de las criaturas, las estrellas cercanas más brillantes, la corona, el abanico y la nova del ganador.
- **Pintura por color** (`paintFor`): la primera vez que aparece un color de jugador se crean sus sprites de glow, de estrella y de gas, y se guardan con él. Nunca se piden sprites dentro de un bucle por segmento.
- **Rampas del cuerpo** (`rampFor`): por cada color y cada uno de 8 niveles de atenuado (alpha de 1 a 0,3, para el fin de la partida), tres rampas de 32 colores de cabeza a cola, una por capa de gas (5.4). El color es `mix(body, deep, smoothstep(0,2, 1, t) × 0,4)` y el alpha vale 1 hasta `t = 0,5` y baja linealmente a 0,45 en `t = 1`. Se precalculan opacas, mezclando contra `mix(fondo, body, 0,08)` con peso `0,5 × alpha` (borde), `0,68 × alpha` (cuerpo) y `0,84 × alpha` (centro). La cabeza tiene su color aparte: `body` con un 12 % de `core`, mezclado igual. Se indexa con `Math.round(t * 31)`.
- **Planetas** (5.8): un sprite por valor, con contorno, superficie, sombra, borde de atmósfera, dígito y anillo horneados. Se regeneran al cambiar `s`, la resolución del backing store, la escala de la arena o al cargar las fuentes.
- **Rayo de aurora** (5.9): un canvas de 16 × 96 con el degradado vertical del rayo y una máscara horizontal que lo afina a los costados.
- **Etiquetas de nombre**: un sprite por serpiente, con el nombre truncado a 12 caracteres más "…", dibujado con contorno `rgba(7,7,13,0.85)` de 3 px y relleno `text`. Se regenera solo si cambia el nombre, el color, la escala de la arena o al cargar las fuentes.
- **Dígitos del contador gigante**: un sprite por número (10 a 1), cada uno con su color y el glow horneado una sola vez (`shadowBlur` de 36 y 12 px, a resolución reducida). Se generan de a uno por frame cuando a la partida le quedan 16 segundos o menos, así no hay tirones en el momento tenso.
- **Sin allocations por frame**: buffers reutilizados (`Float32Array` para puntos de cuerpo, estelas, estrellas y lunas), sin `map`, `filter`, spread ni creación de objetos dentro del bucle de render. Las opciones de ráfaga son objetos fijos que se reescriben. Los registros por id (`Map`) se crean al aparecer una entidad, no por frame.

### 5.4 Serpiente

Cada serpiente se dibuja como una criatura del vacío, con un cuerpo continuo de gas translúcido, a partir de `snake.getRenderSegments()` (posiciones interpoladas por `js/net/motion.js`).

**Geometría.** `P_i` es el centro del segmento `i`, con `n` segmentos. `t_i = i / max(n - 1, 1)` va de 0 (cabeza) a 1 (cola). El radio del cuerpo es `r(t) = s × (0,46 - 0,22 × t^1,4)`: 0,46·s junto a la cabeza y 0,24·s en la punta de la cola.

**Ondulación.** Cada punto, salvo la cabeza, se desplaza sobre la normal local (perpendicular a `P_{i-1} - P_{i+1}`, normalizada, usando solo vecinos del mismo tramo) una distancia `A(t) × sin(now × 0,006 - i × 0,9)`, con `A(t) = s × 0,09 × smoothstep(0, 0,25, t)`. Es poca amplitud a propósito: la posición jugable no cambia de celda. Desactivada con movimiento reducido y en calidad Q0.

**Trazo.** El cuerpo sigue una curva suave por puntos medios (cuadráticas con control en cada `P_i`), que empalma sin quiebres. Se dibuja en trozos con extremos `'butt'` (el último, `'round'`): un punto por trozo hasta 24 segmentos, 2 hasta 48 y `ceil(n / 24)` desde ahí. Cada trozo toma el grosor y el color de su punto medio y se solapa 0,7 px con el siguiente para que el antialias no deje costura.

**Pasadas.**

1. **Halo** (`'lighter'`): sprite de glow `body` cada 2 puntos en Q2 (alpha × 1,5) y cada 3 en Q1 y Q0 (alpha × 1,95), de radio `4,2 × r(t)` y alpha `0,16 × (1 - 0,5t)`, con tope 1. El halo respira de a trechos: el radio varía ±14 % con `sin(now × 0,0021 - i × 0,7)`, fijo con movimiento reducido. Usa el sprite grande cuando `4,2 × 0,46·s` pasa de 24 px. La serpiente propia multiplica el alpha por 1,25.
2. **Velo de inmunidad y alcance de la boca grande**, cuando están activos (5.7 y 5.9).
3. **Cuerpo** (`'source-over'`): tres capas de gas, cada una más angosta, densa y clara: borde tenue (ancho completo, `2 × r(t)`), cuerpo (76 %) y centro (48 %), cada una con su rampa (5.3). No hay contorno luminoso: el volumen sale del salto chico entre capas.
4. **Gas** (`'lighter'`, sin bordes): un **núcleo** de manchas de gas `core` sobre el eje, desde el segundo punto: en Q2, una por punto en la mitad de adelante (radio `1,75 × r`) y cada 2 hacia la cola; en Q1 y Q0, cada 2 puntos. Donde van espaciadas, el radio sube a `2,3 × r` y el alpha × 1,25. Alpha `0,2 × (1 - 0,7t)`, con un radio que late ±12 % con `sin(now × 0,0023 - i × 0,8)`. Encima, solo en Q2, **bocanadas**: manchas `body` cada 3 puntos, corridas a un lado hasta `0,4r`, de radio `r × (1,8 ± 0,5)` y alpha `0,25 × (1 - 0,6t) × (0,6 ± 0,4)`, en una ola que viaja de la cabeza a la cola (fase `now × 0,0016 - i × 0,55`). Le dan al cuerpo textura de nube en movimiento sin perder la silueta.
5. **Estrellas internas** (`'lighter'`, `passStars`): estrellitas de 4 puntas (estrella `core`) que titilan dentro del gas. Con `titileo = 0,5 + 0,5 × sin(now × 0,0035 + i × 1,7)` y `chispa = titileo²`, el radio es `r × k × (0,7 + 0,45 × chispa)` y el alpha `(0,3 + 0,7 × chispa) × (1 - 0,35t)`. El patrón depende de `slot % 4`:
   - **0**: pares laterales (±0,5r sobre la normal) cada 3 segmentos, con `k` = 0,8.
   - **1**: una sobre la línea central cada 2 segmentos, con `k` = 1,05.
   - **2**: alternadas a un lado y al otro (±0,5r) cada 2 segmentos, con `k` = 1,05.
   - **3**: tríos en línea a lo largo del cuerpo (el punto y ±0,32·s sobre la tangente) cada 5 segmentos desde el punto 2, con `k` = 0,8.
   Con `s` menor a 12 se duplica la separación. Con movimiento reducido el titileo queda en un 35 % de su recorrido. En la misma pasada, cada 7 segmentos corre un **pulso de luz** tenue de la cabeza a la cola a 8 segmentos por segundo (glow `core` de radio `1,6 × r` y alpha `0,26 × (1 - t)`), y la **digestión** de 5.12.
6. **Cabeza**: primero un glow `core` de radio `1,1·s` y alpha 0,55, el núcleo denso del gas; después una elipse centrada en `P_0 + dir × 0,08·s`, de radio 0,56·s a lo largo de la dirección y 0,48·s a lo ancho, rellena con el color de cabeza de la rampa; encima, otro glow `core` de radio `0,55·s` y alpha 0,4 en `P_0 + dir × 0,05·s`. Ojos: dos círculos en `P_0 + dir × 0,18·s ± normal × 0,22·s`, esclerótica de radio `0,12·s` en `#F6F3EE` y pupila de `0,07·s` en `#030307` desplazada `0,03·s` hacia adelante.

**Polvo de la cola.** Cada criatura de 4 segmentos o más suelta motas finas desde uno de sus últimos 3 puntos: una cada 110 ms en Q2 y cada 220 ms en Q1, ninguna en Q0 ni con movimiento reducido. Cada mota (`Particles.emit`) sale corrida hasta medio radio, deriva hacia atrás a 4 a 12 px/s con hasta ±4,5 px/s de costado, vive de 700 a 1300 ms, mide de 0,35 a 0,7 px y termina en 0,15, con alpha 0,45 y `drag` 0,985; el 30 % es del color `core` y el resto `body`. Siempre es más chica y tenue que la comida. Si las partículas activas pasan del 60 % del tope, no se emite: el polvo no les quita lugar a los efectos.

**Dirección visual**: `normalizar(P_0 - P_1)` si los dos están en el mismo tramo y a más de `0,2·s`; si no, `snake.direction`.

**Nivel de detalle.** Con `s` menor a 12: ojos como dos puntos oscuros de 1 px; las estrellas internas se mantienen con la separación duplicada, porque son la segunda señal para distinguir jugadores. Con un solo segmento: solo cabeza y halo.

**Serpientes con `gameover`**: no se dibujan.

### 5.5 Corte en portales

Cuando una serpiente cruza un borde, dos puntos consecutivos quedan a más de media arena de distancia. El cuerpo se corta ahí: nunca se dibuja una línea que cruce la arena.

- Al recorrer los puntos, si `|P_{i+1}.x - P_i.x| > W/2` (384) o `|P_{i+1}.y - P_i.y| > H/2` (216), se cierra el tramo actual en `P_i` y se abre otro en `P_{i+1}`, hasta 32 tramos. El halo y el cuerpo se dibujan por tramo, y la ondulación y las normales usan solo vecinos del mismo tramo. El gas y las estrellas internas son sprites por punto, así que nunca cruzan; los pulsos de luz y la digestión no interpolan a través de un corte.
- `t` sigue siendo el índice global del segmento, para que el grosor y el color sean continuos de un lado al otro.
- En cada extremo de tramo que toca un borde, las tres capas del cuerpo siguen en línea recta, con extremo `'butt'`, hasta 2 px afuera del borde, y un glow `body` grande de radio `1,8·s` y alpha 0,35 se dibuja sobre el borde (x o y fijada en 0, W o H), para que la criatura parezca atravesarlo.
- Esto se suma a la interpolación de `js/net/motion.js`, que lleva cada segmento por el lado corto de la arena: sale por un borde y, cuando su centro lo cruza, pasa al borde opuesto. Nunca viaja de un borde al otro por adentro.

### 5.6 Jugador propio y etiquetas

La serpiente propia tiene señas que no dependen del color, y las demás llevan su nombre.

- La serpiente con `id === state.myId` se dibuja última en cada pasada, con halo × 1,25.
- **Pulso**: cada 2400 ms (contados desde 600 ms después del inicio de la partida), un anillo `#F6F3EE` de 1,5 px crece de radio `0,8·s` a `2,2·s` con `easeOutCubic` alrededor de su cabeza, con alpha de 0,35 a 0, en 900 ms. Es la forma de encontrarse sin depender del color. También corre en la arena de espera.
- **Etiqueta "Tú"** en `#EAC255` (el token `--bio-lime`), Recursive 700 a 1,08 veces el tamaño de etiqueta, sobre la cabeza propia durante los primeros 2500 ms de la partida (entra en 200 ms y se va entre los 2100 y los 2500 ms) y durante el congelamiento final si ganó. El resto del tiempo, la propia no lleva etiqueta.
- **Etiquetas de otros**: el nombre sobre la cabeza, centrado en `P_0.y - (0,9·s + 8)`; si queda a menos de 16 px del borde superior, va debajo. Nunca se sale de la arena por los costados. Alpha `0,8 × (0,4 + 0,6 × atenuado)`; la del ganador, 1. Tamaño lógico `max(11, 10 / escala)` para que nunca baje de 10 px CSS. Recursive 600.
- **Desolapado**: cada etiqueta dibujada reserva su rectángulo, con 2 px de margen. Si la siguiente lo pisa, prueba del otro lado de la cabeza; si tampoco entra, se omite en ese frame. Se dibujan en orden de prioridad (propia, ganador, las más largas), así las que se omiten son las menos relevantes.
- **Espectador** (`state.spectating`): no hay serpiente propia; ninguna lleva "Tú" ni pulso.
- **Corona**: la serpiente de `state.leaderId` (la más larga, decidida por el servidor: `gameState.leaderId`, `docs/GAMEPLAY_SPEC.md`) lleva una corona de luz justo encima de la cabeza, siempre derecha en la pantalla y debajo de la etiqueta: base de `1,4·s` de ancho a `0,75·s` sobre el centro de la cabeza, tres puntas (las de los lados a `0,42·s`, la del medio a `0,62·s`), relleno `rgba(255, 224, 138, 0.28)` y trazo `#FFE08A` de 1,4 px con alpha 0,95, una estrellita de 4 puntas `#FFE08A` de radio `0,42·s` en cada punta y un glow dorado de radio `1,3·s` con alpha 0,55. Sube y baja ±0,6 px. Se dibuja con la partida en curso y durante el congelado final; en el modo atracción, no.

### 5.7 Inmunidad

La inmunidad se ve como una magnetosfera: un arco de choque delante de la cabeza, violeta afuera y verde oxígeno adentro, con brillo de aurora que ondula, y un velo tenue sobre todo el cuerpo. Está activa si existe `snake.effects.immunity`, la hora del servidor en que vence (el servidor solo manda los efectos activos). Ese valor se usa solo para el aviso de vencimiento, comparado con `Date.now()`, porque puede haber desfase entre los relojes del servidor y del cliente.

- **Arco**: 12 tramos que cubren ±1,3 rad alrededor del rumbo, centrados en `P_0 + dir × 0,12·s`, de radio `0,8·s` que crece hacia los costados (`× (1 + 0,3θ²)`), así el arco se abre hacia atrás como una onda de choque. Dos capas en `'lighter'`: afuera `#D9CFFF` de 1,5 px con alpha 0,8; adentro, al 80 % del radio, `#A8EADF` de 1,1 px con alpha 0,45. Cada tramo es más ancho y claro al frente que en las puntas (alpha y grosor por `1 - |2u - 1|`), ondula ±0,05·s y titila entre el 72 y el 100 %, como una cortina.
- **Brillo**: un glow `#C7B8FF` (`--bio-shield`) de radio `1,5·s` y alpha 0,38, `0,6·s` delante de la cabeza, y cinco manchas blandas sobre el arco, violeta `#BDAEFF` y verde `#A8EADF` alternadas, de radio `0,5·s` ± 20 % y alpha `0,32 - 0,12 × |θ|`.
- **Velo del cuerpo**: a lo largo de todo el cuerpo, cada 2 puntos (cada 3 en Q1 y Q0, con alpha × 1,3), manchas violetas y verdes alternadas de radio `2,6 × r(t) + 0,3·s` y alpha `0,2 × (0,6 + 0,4 × sin(now × 0,004 - i × 0,6)) × (1 - 0,4t)`: una onda de brillo que corre hacia la cola. Dice que todo el cuerpo está protegido; la seña fuerte es el arco.
- **Aviso de vencimiento**: cuando faltan menos de 1500 ms, el arco y el velo parpadean a 4 Hz entre alpha 1 y 0,25.
- **Al activarse** (`onConsumablePicked`, o cuando el efecto aparece en el estado si el evento no llegó): el arco se infla de escala 0 a 1 en 360 ms con `easeOutBack`. **Al bloquear** (`onBlock`): el arco estalla, se abre hacia adelante hasta escala 1,7 con `easeOutCubic`, con el trazo a la mitad, y se apaga en 320 ms.
- Con movimiento reducido el arco no ondula ni titila.

### 5.8 Comida

La comida son planetas chicos, de tamaño y color según su valor (1 a 5). El valor siempre se puede leer por la cantidad de lunas que orbitan; el dígito se agrega cuando hay espacio. Los radios están en px de la arena y no dependen de la celda, para que la comida se lea a cualquier escala. Los colores van de verde a ámbar y evitan el violeta del escudo.

| Valor | Radio del planeta | Color | Lunas y superficie |
|---|---|---|---|
| 1 | 4,0 px | `#8FE3B4` | 1, rocoso |
| 2 | 4,4 px | `#BEE07A` | 2, rocoso |
| 3 | 4,8 px | `#E6DC6A` | 3, gaseoso |
| 4 | 5,2 px | `#F2C35A` | 4, gaseoso |
| 5 | 5,6 px | `#EE9A52` | 5, gaseoso con anillo |

- **Planeta** (sprite de 5.3): contorno oscuro `rgba(10, 9, 16, 0.88)` de 1,3 px alrededor del disco, que lo separa de su halo y de las estrellas (ninguna estrella lo tiene); disco del color plano; superficie en el color mezclado un 35 % con la noche `#09080F`, alpha 0,45: los rocosos con dos manchas (de radio `0,26r` y `0,18r`), los gaseosos con tres bandas apenas inclinadas (-0,22 rad). Encima, la sombra con terminador suave: un degradado radial desde la luz, arriba a la izquierda en `(-0,45r, -0,45r)`, de radio `1,95r`, que pasa de transparente a alpha 0,5 en 0,68, 0,86 en 0,82 y 0,95 en el borde. Un brillo `rgba(246,243,238,0.6)` de radio `0,85r` en el punto de luz y un borde de atmósfera del lado iluminado (arco de 0,8π a 1,7π) en el color mezclado un 45 % con `#F6F3EE`, alpha 0,5.
- **Anillo del 5**: elipse inclinada -0,42 rad, de radios `2,05r` y `0,6r`, en el color mezclado un 30 % con `#F6F3EE`, con un anillo interior al 80 %. La mitad de atrás va debajo del planeta, más apagada (alpha 0,5 y 0,3); la de adelante va encima, con un contorno oscuro de 2,6 px y alpha 0,95 y 0,55.
- **Halo**: sprite de glow del color con radio `1,9 × r × (1 + 0,1 × valor)` y alpha 0,8, en `'lighter'`.
- **Lunas**: discos nítidos `#E9E3D8` que orbitan en una elipse de radio `1,7r + 1,6` px achatada al 60 % e inclinada `0,38 + 0,3 × sin(3 × fase)` rad (cada planeta tiene la suya), a 1,1 rad/s, espaciadas de forma pareja. Las de la mitad de adelante de la órbita miden 1,1 px de radio y llevan un glow `#F6F3EE` de radio 2,9 px con alpha 0,45; las de atrás miden 0,85 px, van al 60 % y se dibujan antes que el planeta, que las tapa. Con movimiento reducido quedan quietas.
- **Quietos**: los planetas no laten ni flotan; lo único que se mueve son las lunas. La fase de cada planeta sale de su posición: `((x × 73856093) ^ (y × 19349663)) & 1023`, normalizado a 0 a 2π. Sin números al azar por frame.
- **Dígito**: si `1,15·r × escala ≥ 7` px CSS, el valor en Recursive 700 de tamaño `1,15·r`, color `#0A0910`, horneado sobre el centro del planeta.
- **Orden de dibujo**: primero, en `'lighter'`, los halos y los glows de las lunas de adelante de todos los planetas; después, en `'source-over'` y por planeta, las lunas de atrás, el planeta y las lunas de adelante.
- **Restos** (comida con `remains`, ver `docs/MOTION_SPEC.md`): se dibujan igual que la comida de su valor y aparecen con el mismo crecimiento de 450 ms. En sus últimos 2 s se desvanecen: `fade = (expiresAt - rt) / 2000`, con `rt` la hora del servidor del instante dibujado, que `SnakeGame.js` calcula al aplicar cada muestra de la línea de tiempo.

### 5.9 Consumibles

Hay tres consumibles: escudo, boca grande y abanico (`docs/GAMEPLAY_SPEC.md`). Cada uno tiene su silueta y su color, de tamaño fijo en px de la arena, y los tres comparten el pulso de baliza en su color: es la seña de que algo se puede tomar. No flotan: quedan quietos donde aparecieron. Los colores salen de `CONS_LOOK` en `arena.js`:

| Tipo | Baliza | Anillo al tomarlo | Partículas claras |
|---|---|---|---|
| Escudo | `#BDAEFF` | `#C7B8FF` | `#E4DDFF` |
| Boca grande | `#F29BC9` | `#F29BC9` | `#FFD6EC` |
| Abanico | `#F0875F` | `#F0875F` | `#FFE3D9` |

**Baliza.** Cada 2000 ms (con fase propia), un anillo de 1,5 px en el color de la baliza se abre de radio 9 a 26 px con `easeOutCubic` mientras su alpha baja de 0,5 a 0 (al cuadrado), en `'lighter'`. Es lo que lo hace visible de lejos. Se distingue del pulso de la cabeza propia por el color y porque el consumible no se mueve.

**Escudo.** Una aurora, más ancha que alta: un velo de 13 rayos finos colgados de una cinta que ondula en S. Glow `#BDAEFF` de radio 18 px con alpha 0,45. Los rayos (sprite de 5.3) se reparten en ±10,5 px, miden 2,6 px de ancho y hasta 10 px de alto, más altos al centro, y cada uno cambia de alto entre el 56 y el 100 % con su propia fase. Su base sigue la cinta, `cy + 3,2 - 1,6·x0 + 2,6 × sin(4,6u + now × 0,0015)` (con `x0` de -1 a 1 y `u` de 0 a 1), que se desliza despacio. Cada rayo va del borde claro verde oxígeno de abajo (`rgba(206,242,234,0.95)`) al violeta (`rgba(199,184,255,0.75)` al 22 %) y se apaga hacia arriba; alpha 0,85, en `'lighter'`. Puesta, la inmunidad es la magnetosfera de 5.7.

**Boca grande.** Un agujero negro visto de frente: disco de acreción rosa con brazos en espiral que giran y caen hacia el centro (atrae la comida), horizonte negro y un anillo de fotones fino y claro. Glow `#F29BC9` de radio 17 px con alpha 0,42. Disco: trazo `#F29BC9` de 4,4 px a radio 6 px, con alpha 0,32. Brazos: tres espirales de 9 tramos de 1,2 px que van del radio 9,8 al 4 px mientras avanzan 2,4 rad, cada tramo más claro hacia adentro (alpha `0,9 × u`, en `#FFD6EC` desde `u` = 0,55 y en `#F29BC9` antes), que giran a 1,9 rad/s. Horizonte: disco `#030307` de radio 3,4 px. Anillo de fotones: `#FFE3F0` de 0,9 px a radio 3,85 px, con alpha 0,85. Va de frente, y no de canto, para que no se confunda con el planeta anillado del valor 5.

- **Alcance activo**: mientras dura el efecto, un anillo `#F29BC9` de 1 px y alpha 0,18 marca el alcance alrededor de la cabeza (radio `bigMouthReach × s`, 30,6 px con los valores de hoy), y 14 motas de polvo rosa (glow `#F29BC9` de radio `max(1,6, 0,2·s)`) caen en espiral desde ese borde hacia la boca: cada una baja del radio completo al 40 % en unos 2,2 s mientras gira, con alpha `0,8 × (1 - u)` (`u` de 0 en el borde a 1 en la boca) que entra en el primer 12 % del recorrido. Se dibuja junto con los halos, en `'lighter'`.

**Abanico.** Una estrella triple coral: tres soles de distinto tamaño que giran despacio alrededor de su centro común, sobre una órbita apenas marcada. Glow `#F0875F` de radio 16 px con alpha 0,42; órbita `#F0875F` de 1 px a radio 5,4 px, con alpha 0,18; tres estrellas de 4 puntas `#F0875F` a 120° entre sí, de radio 7,5, 5,5 y 4,7 px (alpha 0,95), cada una con un núcleo de luz `#F6F3EE` de radio 2,8, 2 y 1,7 px (alpha 0,9). Giran a 0,9 rad/s.

Con movimiento reducido, los tres quedan quietos; la baliza sigue.

### 5.10 Proyectiles

Pulso de luz con estela. Posición: `x, y` que `Motion.projectileAt` (`js/net/motion.js`) interpola para el instante dibujado, más `s/2`.

- **Núcleo**: cápsula orientada en `direction`, largo `0,9·s` y ancho `0,36·s`, color `core` del tirador (resuelto con `Arena.bioColor(projectile.color)`).
- **Halo**: sprite `body` de radio `1,6·s` con alpha 0,8 y parpadeo `1 + 0,15 × sin(now × 0,05)`.
- **Estela**: por cada id, un buffer circular de las últimas 10 posiciones de render (`Float32Array(20)`), muestreadas cada frame. Se dibuja como trazos encadenados que se afinan de `0,36·s` a 0 y bajan de alpha 0,7 a 0, en `'lighter'` con el color `body`. Cuando el id deja de venir en el estado, la estela se desvanece en 300 ms y el buffer se libera. Q0: 5 posiciones.

### 5.11 Apariciones

El servidor no avisa cuando aparece comida o un consumible, así que la arena lo detecta. Cuando `state.foods` cambia de referencia (el integrador reemplaza el array en cada frame del servidor), se compara contra el conjunto anterior con claves numéricas `x × 1000 + y` (sin strings). Lo nuevo entra con escala 0 a 1 en 450 ms con `easeOutBack` y un anillo del color de su valor que crece de `0,3·s` a `1,4·s` en 360 ms, con alpha 0,7. Los consumibles se comparan por `id`: entran con la misma escala y un anillo `#C7B8FF` de `0,3·s` a `1,8·s` en 420 ms. La primera vez que llega un estado (inicio de la partida o entrada como espectador) no hay animación de aparición.

### 5.12 Catálogo de efectos por evento

INTEGRADOR llama al hook correspondiente por cada elemento de los arrays de `gameLogicFrame` (sección 9) cuando el render alcanza ese frame, **antes** de aplicar las posiciones nuevas a las serpientes. La arena guarda una referencia al último `state` recibido para ubicar serpientes por id.

Valores de partículas: `count` es la cantidad; `speed` en px/s; `life` en ms; `size` en px de radio para `s` igual a 20 (Arena lo multiplica por `s / 20` antes de llamar a `burst`); `drag` es la fracción de velocidad que se conserva cada 1/60 s. Todas las ráfagas de la arena usan `gravity` 0: en el vacío nada sube ni se hunde. Los anillos crecen con `easeOutCubic` mientras su alpha baja a 0, y los textos flotantes entran en el primer 15 % de su vida y se apagan desde el 55 %. "Si soy yo" significa `e.targetId`, `e.playerId` o `e.attackerId === state.myId`, según el caso. Las cantidades bajan al 50 % con movimiento reducido.

- **Comer** (`onFoodEaten`, `foodEvents`). Centro de la celda. Ráfaga: `count` = 6 + 4 × valor, color de la comida (tabla 5.8), `speed` [30, 70 + 20 × valor], `life` [380, 700], `size` [1,2, 2,4], forma `dot`, `drag` 0,9. Anillo del mismo color de `0,4·s` a `1,8·s` en 320 ms con alpha 0,7. **Digestión**: un bulto de luz recorre el cuerpo del que comió de la cabeza a la cola a 22 segmentos por segundo (máximo 3 a la vez por serpiente): un glow `core` de radio `2,75 × r` con alpha 0,55 y un glow `body` de radio `3,75 × r` con alpha 0,35, que se apagan en el último 20 % del cuerpo. Si soy yo: texto flotante "+{valor}" en el color de la comida, Recursive 700 a 1,15 veces el tamaño de etiqueta, que sube 18 px y se desvanece en 700 ms. **Con la boca grande**, si la comida estaba a más de `1,2·s` de la cabeza (y a menos de `4·s`, para no cruzar un portal), una estela la lleva hasta la boca en 170 ms: un trazo del color de la comida de 2 px a 1 px y una perla de luz `#F6F3EE` de radio `0,9·s` que acelera (`t²`) hacia la cabeza, que sigue moviéndose.
- **Impacto en el cuerpo** (`onHit`, `headshot` falso). En la celda del impacto. Fragmentos: `count` = min(48, 10 + 5 × `segmentsLost`), repartidos 60 % forma `spark` y 40 % `dot`, color `body` de la víctima, `speed` [60, 200], `life` [500, 1000], `size` [1,5, 3,2], `drag` 0,9. Chispa del atacante: 6 `spark` del color `body` del atacante, `speed` [80, 160], `life` [250, 400], `size` [1,2, 2,2]. Destello: sprite `#F6F3EE` de radio `2,5·s` con alpha de 0,5 a 0 en 160 ms. **Cola desprendida**: los últimos `segmentsLost` puntos de render de la víctima (copiados en el hook, antes de que lleguen las posiciones nuevas, hasta el primer corte de portal) siguen dibujándose como gas apagado (glow `body` cada 2 puntos con alpha 0,18, trazo `deep` con alpha 0,6 y una línea `body` fina con alpha 0,5), derivan hacia un lado al azar (hasta ±10 px/s en cada eje, sin hundirse) y se apagan en 900 ms. El gas del pedazo se deshace en polvo: 2 partículas `dot` cada 2 puntos, alternando `core` y `body`, `speed` [6, 28], `life` [600, 1200], `size` [0,6, 1,3], alpha 0,6, `drag` 0,97. Texto flotante con el signo menos tipográfico (U+2212) y `segmentsLost`, en el color `text` de la víctima, a 1,2 veces el tamaño de etiqueta, que sube 22 px en 900 ms, siempre. Sacudida: si soy la víctima, 7 px durante 280 ms y `Backdrop.pulse('#EC4F5A', 0.25)`; si soy el atacante, 2,5 px durante 120 ms.
- **Impacto sin daño** (`onHit` con `segmentsLost` en 0: con la regla vieja, un disparo en la cabeza de una serpiente de un segmento; con daño fijo no pasa, y queda por si el cliente habla con un servidor viejo). Las ráfagas y el destello salen igual, pero no hay cola desprendida ni número: el texto flotante dice "Sin daño" (800 ms). Si soy la víctima, sacudida de 3 px durante 140 ms.
- **Impacto en la cabeza** (`onHit`, `headshot` verdadero). Todo lo anterior con 12 fragmentos más, destello con alpha 0,7 y dos anillos: uno `body` de la víctima de `0,4·s` a `2,2·s` en 420 ms (alpha 0,8, 2 px) y otro `#F6F3EE` de `0,4·s` a `3·s` en 480 ms (alpha 0,5), 90 ms después. **Polvo oscuro**: 12 partículas de forma `ink` (el nombre de la forma es heredado; hoy dibuja polvo), color `#1C1410`, `size` [5, 10] que se abre hasta [9, 17], `speed` [8, 34], `life` [1300, 2000], `drag` 0,96, alpha 0,55, en `'source-over'`; con 8 motas `dot` de polvo cálido `#8A5A3C`, `speed` [10, 50], `life` [900, 1500], `size` [0,8, 1,6], alpha 0,5, `drag` 0,95. Sobre el número flotante, la palabra "cabeza" en el tamaño de etiqueta (con el mínimo de 10 px CSS). Sacudida: víctima 10 px durante 360 ms; atacante 4 px durante 160 ms.
- **Eliminación** (`onHit` con `eliminated` verdadero, `docs/GAMEPLAY_SPEC.md`, etapa 5). Todo lo del impacto en la cabeza, haya sido en la cabeza o no, con 20 fragmentos más. La cola desprendida es el cuerpo entero, cabeza incluida (hasta 96 puntos). Un tercer anillo `body` de la víctima, de `0,6·s` a `4,2·s` en 720 ms (alpha 0,6, 1,5 px), 160 ms después. En lugar del número, el texto flotante "Fuera" en el color `text` de la víctima, a 1,3 veces el tamaño de etiqueta, que sube 26 px en 1200 ms. Sacudida: víctima 12 px durante 420 ms y `Backdrop.pulse('#EC4F5A', 0.4)`; atacante 5 px durante 200 ms. Desde el frame siguiente la serpiente llega con `gameover` y sin segmentos, y la arena no la dibuja.
- **Bloqueo** (`onBlock`). En la celda del bloqueo. Chispas de aurora: 10 `spark` `#C7B8FF`, `speed` [50, 150], `life` [450, 850], `size` [1,3, 2,8], y 6 `spark` `#A8EADF` (verde oxígeno), `speed` [40, 120], `life` [400, 750], `size` [1,1, 2,4], todas con `drag` 0,9. Dos anillos `#C7B8FF`: de `0,4·s` a `2·s` en 380 ms (alpha 0,8) y de `0,4·s` a `2,8·s` en 420 ms (alpha 0,5), 80 ms después. La magnetosfera del jugador estalla (5.7). Si soy el jugador o el atacante: texto flotante "Bloqueado" en `#C7B8FF` (900 ms). Si soy el jugador: sacudida de 3 px durante 140 ms y `Backdrop.pulse('#C7B8FF', 0.15)`.
- **Portal** (`onPortal`, con `fromX`, `fromY`, `toX`, `toY`). En los dos puntos de cruce sobre el borde: onda en media elipse aplastada contra el borde (radio `1,6·s` a lo largo del borde y `0,5·s` hacia adentro, que se abre con `easeOutExpo`) del color `body`, trazo de 2 px con alpha 0,6 y glow con alpha 0,3, en 420 ms; 6 partículas `dot` por lado que se alejan del borde hacia adentro (apertura 1,6 rad, `speed` [30, 90], `life` [350, 650]); el borde se enciende (5.2). Sin sacudida.
- **Disparo** (`onProjectileFired`). En el punto de salida: 6 `spark` en cono (dirección del disparo, apertura 0,9 rad), color `body` del tirador, `speed` [80, 180], `life` [180, 320], `drag` 0,88. **Costo visible**: en la punta de la cola del tirador (último punto de render), el segmento gastado se va en una bocanada de gas que se abre un 60 % y se apaga donde quedó en 500 ms (glow `core` de radio `0,84·s` con alpha 0,9 y glow `body` de radio `1,4·s` con alpha 0,6, al empezar), con 4 partículas chicas `body` (`speed` [10, 40], `life` [300, 500]). La cabeza del tirador retrocede `0,15·s` durante 90 ms (solo visual). Si soy el tirador: sacudida de 1,5 px durante 80 ms. **Abanico**: los dos disparos laterales llegan con `spread: true` y solo hacen el cono de chispas de salida; la bocanada de la cola, el retroceso y la sacudida salen una vez, con el disparo central, porque la ráfaga cuesta un solo segmento.
- **Proyectil expirado** (`onProjectileExpired`, **extensión**, `expiredProjectiles`). En la última celda dentro de la arena: 7 `dot` del color del proyectil (la arena recuerda el color por id; si no lo encuentra, `#8FB2FF`), `speed` [20, 60], `life` [300, 500]; anillo de `0,3·s` a `1·s` en 240 ms; si quedó a menos de `2·s` de un borde, ese borde se enciende en ese punto durante 360 ms con alpha 0,7.
- **Consumible recogido** (`onConsumablePicked`, con `x`, `y`, `consumableType`). Anillo del color de "anillo al tomarlo" (tabla 5.9) de `0,5·s` a `2,4·s` en 420 ms, con alpha 0,8 y 1,8 px; 18 `dot`, mitad en el color de las partículas claras y mitad en el de la baliza, `speed` [40, 120], `life` [500, 900], `size` [1,2, 2,6], `drag` 0,92. Solo el escudo infla la magnetosfera del jugador (5.7). Si soy yo: `Backdrop.pulse` con el color del anillo y alpha 0,2 (el toast lo pone INTEGRADOR, con un texto por tipo).
- **Inicio de la partida** (`onRoundStart`; el nombre viene de cuando había rondas). Ola: un anillo desde el centro de la arena que crece de radio 0 a 450 en 800 ms con `easeOutExpo`, `lineWidth` de 40 a 2, `#5ED8C4` con alpha 0,25 en `'lighter'`, con una línea `#F6F3EE` de 2 px encima (alpha 0,18). Los halos de todas las serpientes se multiplican por 1,6 y vuelven a 1 en 600 ms. Serpiente propia: tres anillos `#F6F3EE` seguidos (0, 200 y 400 ms), de `0,5·s` a `4·s` en 700 ms cada uno, con alpha 0,5, y la etiqueta "Tú" (5.6). Se descartan las colas desprendidas y estelas de la partida anterior, y se reinician la detección de apariciones, el contador y la tensión.
- **Fin de la partida** (`onRoundEnd({ winnerId })`). Ver 5.14.

**Sacudida** (`Arena.shake(intensity, ms)`): desplazamiento `dx = I × k × sin(now × 0,071)`, `dy = I × k × cos(now × 0,053)` con `k = (1 - t)²` y `t` el progreso. Si hay varias activas (hasta 4), manda la de mayor intensidad restante. Solo mueve el contenido de la arena (no el HUD ni el marco). Con movimiento reducido no hace nada.

**Límite de destellos**: como máximo 3 destellos por segundo en total (los que excedan se omiten), siempre locales (nunca la arena entera en blanco) y con alpha máximo 0,7 (0,25 con movimiento reducido, 3.6).

### 5.13 Contador de los últimos 10 segundos

Lo dibuja `drawCountdown`. Con `state.playing` verdadero y `roundTimeLeft` entre 1 y 10, se dibuja el número entero (redondeado hacia arriba) centrado en (W/2, H/2 + 12), que en 768 × 432 es (384, 228), en Fraunces itálica 300 desde los sprites de dígitos, en `'lighter'`, debajo de lo jugable (capa 6). El tamaño escala con el alto del mundo (`× H / 600`).

| Segundos | Tamaño lógico | Color | Alpha base |
|---|---|---|---|
| 10 a 6 | 216 px | `#5ED8C4` | 0,10 |
| 5 y 4 | 216 px | `#F08A3C` | 0,14 |
| 3 a 1 | 244,8 px | `#EC4F5A` | 0,20 |

En cada cambio de número: escala de 1,18 a 1 en 450 ms con `easeOutExpo` y alpha que arranca en el doble de la base y baja a la base; también dispara el golpe de la viñeta de tensión (5.2). Con movimiento reducido, sin escala.

### 5.14 Fin de la partida en la arena

Al recibir `onRoundEnd({ winnerId })`, la arena entra en congelamiento durante 2400 ms (las llamadas a `render` siguen llegando con el último estado congelado):

- **Cámara lenta**: el reloj de animación baja al 25 % de su velocidad en unos 400 ms. Estrellas, nebulosa, gas, ondulación, lunas y consumibles van más lentos; las partículas siguen a velocidad normal.
- Las serpientes que no ganaron bajan a alpha 0,35 (con los niveles de atenuado de 5.3) y pierden el brillo interno del gas (núcleo, bocanadas y pulsos de luz), en 600 ms con `easeInOutSine`. El campo que lo controla conserva el nombre `filament`.
- **Nova del ganador** (el efecto conserva el nombre `FX_COLUMN`, de la columna de luz que reemplaza): la criatura se enciende como una estrella cercana, debajo de lo jugable. Un halo `body` grande crece de radio `2,4·s` a `3,6·s` y una estrella de 4 puntas `#F6F3EE` con rayos de difracción largos, de `4·s` a `7·s`, las dos en 900 ms con `easeOutCubic`; un anillo `core` de 1,2 px se abre de `1,5·s` a `6·s` en 1800 ms mientras se apaga. El conjunto entra en 500 ms hasta alpha 0,5 y dura todo el congelamiento. **Polvo estelar** (efecto `FX_FOUNTAIN`): 80 partículas repartidas en 1200 ms desde su cabeza, alternando `body` y `core`, en todas direcciones, `speed` [40, 140], `life` [900, 1600], `size` [1,2, 2,6], `drag` 0,96. Su etiqueta crece a 1,4 veces en 500 ms y queda con alpha 1.
- Si el ganador soy yo: `Backdrop.pulse('#EAC255', 0.5)`, y la etiqueta "Tú" se queda durante el congelamiento.
- La viñeta de tensión, el tinte rojo de la nebulosa y el contador gigante se desvanecen en 800 ms.
- Si `winnerId` es nulo (empate: el integrador lo manda nulo cuando hay más de un ganador), solo la cámara lenta y el fundido de la tensión y el contador.

A los 2000 ms entra la pantalla final encima (4.17). Después del congelamiento, el integrador pasa a `Arena.renderIdle` debajo del final.

### 5.15 Modo atracción (renderIdle)

`Arena.renderIdle(nowMs, { snakesPreview, caption })` mantiene la arena viva cuando no hay partida en curso: en la sala de espera y debajo de la pantalla final. Dibuja las capas de fondo (nebulosa al 70 %), las estrellas cercanas a tamaño y alpha completos, con su encendido (5.2), y una criatura por jugador de `snakesPreview` (**extensión** de forma: `[{ id, name, color, isMe }]`; `caption` es un texto opcional, también extensión). No hay comida, consumibles, contador ni corona.

- Cada criatura anda suelta: rumbo que cambia suave (ruido de valor con período de 3 a 5 segundos, hasta 1,5 rad/s), velocidad de 38 px/s, y giro hacia el centro cuando se acerca a menos de `40 + s_idle` px de un borde (no cruza portales en este modo). El cuerpo se arma con un historial de posiciones muestreado cada `0,8 × s_idle` de recorrido, 10 puntos, con `s_idle = clamp(segmentSize, 14, 22)` (14 con la celda de hoy). Se dibuja con el mismo renderizador de 5.4, incluidos gas, estrellas internas, ojos, polvo de la cola y etiqueta con el nombre.
- La propia (`isMe`) lleva etiqueta "Tú" permanente y pulso.
- **Eclosión** (id nuevo en `snakesPreview`): en un punto al azar a más de 80 px de los bordes, un anillo `core` que crece de `0,3·s_idle` a `2,4·s_idle` en 700 ms y 20 partículas `body` (`speed` [20, 80], `life` [500, 1000]); la criatura crece de 2 a 10 puntos en 1200 ms.
- **Continuidad con la partida**: si el id corresponde a una serpiente dibujada en partida en los últimos 4 segundos, la criatura nace donde quedó esa serpiente (cabeza a más de 30 px de los bordes, historial tomado de su cuerpo) y el resto del cuerpo, desde el punto 11, se deshace en una nube de gas: una partícula cada 2 o 3 puntos, `body` y `core`, `speed` [12, 46], `life` [450, 1100].
- **Disolución** (id que desaparece): el cuerpo se convierte en partículas (3 por punto, `speed` [10, 40]) que se dispersan sin subir y se apagan en 900 ms.
- Si `snakesPreview` llega vacío o ausente, andan sueltas 3 criaturas anónimas atenuadas (alpha 0,5, sin etiqueta).
- `caption`: si viene, se dibuja centrado a 28 px del borde inferior en Recursive 500 de 16 px CSS, color `#ADAABB` (`--bio-ink-2`), con contorno `rgba(3,3,7,0.9)` de 4 px; si no entra en el ancho, se achica.
- Las posiciones de las criaturas persisten entre llamadas (claves por id), así una actualización de la lista no reinicia a nadie. Hasta 24 criaturas.

### 5.16 API de Particles

`Particles.createSystem({ max })` devuelve un sistema con un pool preasignado de `max` partículas en arrays tipados (`Float32Array` para x, y, vx, vy, edad, vida, tamaño, tamaño final, alpha, gravedad, drag; `Uint8Array` para forma, blend e índice de color). Si el pool está lleno, la partícula nueva reemplaza a la más vieja (tope duro). Tope por defecto de la arena: 600 en Q2, 400 en Q1, 200 en Q0.

- `burst(x, y, opts)`: `count` (12), `color` (`'#5ED8C4'`), `speed` ([40, 120]), `life` ([400, 800]), `size` ([1, 2,5]), `endSize` (opcional, para anillos), `spread` (2π), `angle` (0), `gravity` (-12; la arena pasa siempre 0), `drag` (0,92), `glow` (verdadero), `shape` (`'dot'`), `alpha` (1). Los rangos `[min, max]` se muestrean uniforme; un número fijo vale igual.
- `emit(opts)`: una partícula con `x`, `y`, `vx`, `vy` explícitos y el resto de las opciones de `burst`.
- `update(dtMs)`: integra con `dt` acotado a 50 ms. Vida: alpha sube en el primer 10 % y baja con `1 - easeInQuart` en el resto.
- `draw(ctx)`: agrupa por forma para cambiar `globalCompositeOperation` pocas veces. Formas: `dot` (sprite de glow), `spark` (línea a lo largo de la velocidad, largo `velocidad × 0,03`), `ring` (círculo trazado que crece de `size` a `endSize`), `bubble` (círculo trazado con un brillo de 1 px arriba a la izquierda), `ink` (sprite oscuro en `'source-over'`).
- `clear()`, `count()`.
- Los colores se registran en un mapa string a índice y su sprite se crea una vez. Sin allocations en `update` ni `draw`.

### 5.17 API de Arena

Firmas del contrato, más las extensiones marcadas:

- `Arena.init(canvasEl)`: toma `#game`, crea los cachés y observa el tamaño del canvas y de su contenedor con `ResizeObserver` (con espera de 120 ms). Backing store = ancho CSS × `min(devicePixelRatio, 2)` (1,5 en Q0), con un tope de 2200 px de ancho y el alto en la proporción del mundo; si la caja no tiene esa proporción, manda el lado más chico. Con `ctx.setTransform(escala, 0, 0, escala, 0, 0)` trabaja siempre en W × H lógicos. El primer frame nunca es negro: dibuja fondo, estrellas, bordes y viñeta.
- `Arena.setConfig({ segmentSize, width, height, bigMouthReach })`: tamaño del mundo (768 × 432 por defecto), de la celda y alcance de la boca grande en celdas. Rehace el canvas y los cachés que dependen del tamaño o de `s`.
- `Arena.resize()`: rehace el canvas en el momento, sin esperar al `ResizeObserver`. Scenes la llama al agrandar la arena para que no se vea estirada mientras anima (4.12).
- `Arena.render(state, nowMs)` y `Arena.renderIdle(nowMs, opts)`: secciones 5.1 a 5.15. Calculan su propio `dt` a partir de `nowMs`.
- Hooks: `onFoodEaten(e)`, `onHit(e)`, `onBlock(e)`, `onPortal(e)`, `onProjectileFired(e)`, `onConsumablePicked(e)`, `onRoundStart()`, `onRoundEnd({ winnerId })`, `shake(intensity, ms)`, y **extensión** `onProjectileExpired(e)`.
- **Extensión** `Arena.bioColor(hex)`: sección 2.3.
- Diagnóstico: `Arena.stats()` (calidad, partículas, tiempos de frame y de dibujo, ancho del backing store) y `Arena.setQuality(q, lock)`.
- **Calidad adaptativa** (interna): arranca en Q2 (Q1 con `pointer: coarse`). Con un promedio móvil de 90 frames mayor a 19 ms (sin contar pausas de más de 1 s), baja un nivel y espera 5 segundos antes de volver a medir. No sube sola. Q1: nebulosa de una sola capa, halo y velo de inmunidad cada 3 puntos, núcleo de gas cada 2 puntos y sin bocanadas, 50 estrellas cercanas, polvo de la cola cada 220 ms, tope de partículas 400. Q0: además, nebulosa quieta horneada en el fondo, sin ondulación ni polvo de la cola, 28 estrellas cercanas, tope 200, estelas de 5 puntos y `devicePixelRatio` máximo 1,5.

## 6. HUD

Responsable: ESCENAS (`HUD.update`, `HUD.show`, `HUD.hide`); LAYOUT estiliza el marcado de 4.21. `#hud` reemplaza a `#infoCanvas`.

### 6.1 Barra superior (`.hud-bar`)

Membrana de 64 px de alto (48 en móvil) del ancho de la arena, en tres zonas.

- **Meta** (izquierda): "Última en pie o la más larga" en Recursive 600 14 px `--bio-ink-2` (12 px en móvil), truncado con elipsis si no entra. Reemplaza a la ronda y sus pips: la partida es una sola.
- **Temporizador** (centro): SVG de 64 × 64 a 56 px CSS. Pista de radio 26 y trazo de 4 px en `rgba(255,255,255,0.08)`; progreso de radio 26 y 4 px con extremos redondeados, `stroke-dasharray` de 163,4 (2π × 26) y `stroke-dashoffset = 163,4 × (1 - timeLeft / roundTime)`, con transición lineal de 1000 ms (así el anillo baja continuo entre los ticks de segundo). Un tercer círculo de radio 29 y trazo de 1 px con `stroke-dasharray: 2 6` gira una vuelta cada 40 segundos: son los cilios. La cifra va en el centro en Recursive MONO 700 24 px, como minutos y segundos ("1:42") desde un minuto y solo segundos por debajo; su `aria-label` lo dice en palabras ("1 minuto y 42 segundos").
- **Estado** (derecha): un indicador por efecto propio activo o el badge de espectador.

Fases del temporizador (`data-phase`, también reflejado en `#scene-arena[data-phase]`). Con `playing` falso (fin de la partida, o espectador antes de que empiece) la fase vuelve a `calm`.

| Fase | Segundos restantes | Color | Comportamiento |
|---|---|---|---|
| `calm` | más de 20 | `#5ED8C4` | Quieto |
| `warn` | 20 a 11 | `#F08A3C` | Cambio de color en 300 ms |
| `tension` | 10 a 0 | `#EC4F5A` | Latido por segundo (escala 1 a 1,12 a 1 en 220 ms con `--bio-ease-jelly`), glow `drop-shadow` en el SVG; desde 3, la cifra queda en `scale(1.16)` |

**Efectos propios**: un `.hud-shield` por tipo (`data-effect`), en orden fijo: escudo, boca grande y abanico. Cada uno aparece con el revelado de 4.20 cuando el efecto está en `effects` del jugador propio: icono de 18 px (magnetosfera, agujero negro o estrella triple), la palabra ("Escudo", "Boca grande", "Abanico"), el tiempo restante con coma decimal ("3,2 s", calculado con la hora del servidor del instante dibujado, que llega en `serverNow`: el reloj del cliente puede estar desfasado) y una barra de 40 × 3 px que se vacía. El abanico no vence (`docs/GAMEPLAY_SPEC.md`, etapa 5): aparece mientras el jugador tiene `fanShots`, muestra las ráfagas que quedan ("×3", "×2", "×1") en lugar del tiempo, y su barra baja una parte con cada ráfaga. El color sale de `--fx`: `#C7B8FF` para el escudo, `#F29BC9` para la boca grande y `#F0875F` para el abanico; borde y fondo son ese color al 40 % y al 7 %. El icono late a 1,6 Hz. Al vencer, sale con opacidad y escala 0,9 en 240 ms. Con dos o más a la vez, cada uno queda en icono y tiempo: la palabra pasa a ser solo para el lector de pantalla y la barra se oculta, así los tres entran en la columna sin pisar el temporizador.

**Espectador**: `.hud-spectator`, píldora con borde violeta, icono de ojo y "Espectador".

### 6.2 Marcador (`.hud-board`)

Lista ordenada de los jugadores, en filas de 36 px. Cada jugador llega con el color del servidor; HUD lo traduce con `Arena.bioColor` y usa `body` para el punto y la barra, y `text` para el nombre.

- Cada fila: rango (MONO 600 14 px `--bio-ink-3`, 20 px de ancho), punto de 10 px en el color `body` con glow, nombre en Recursive 500 16 px color `text` (truncado con elipsis a 12 caracteres), puntaje en MONO 700 16 px alineado a la derecha, y debajo del nombre una barra de 2 px cuyo ancho es la proporción respecto del líder (`--w`), en el color `body` al 70 %, con transición de ancho de 300 ms.
- Fila propia: borde izquierdo de 3 px lima, etiqueta "Tú" en lima 12 px después del nombre.
- Con inmunidad: icono de escudo (magnetosfera) de 14 px en `#C7B8FF` después del nombre.
- `gameover` (quedó fuera, `docs/GAMEPLAY_SPEC.md`, etapa 5): opacidad 0,4 y el puntaje dice "fuera" en lugar del largo. Con largo 0, queda al final del orden.
- Métrica: siempre el largo actual (`score`), con la caption "Largo actual". Al terminar la partida conserva el último valor (ver 4.16).
- Reordenamiento: FLIP de 280 ms con `--bio-ease-standard`, reutilizando los mismos `li` por `data-id` (nunca se reconstruye la lista con `innerHTML`). La fila que sube de posición recibe un glow de su color durante 400 ms.
- Más de 8 jugadores: los 7 primeros más la fila propia con su rango real, separada por un espacio de 8 px con tres puntos tenues.

### 6.3 Comportamiento

- `HUD.update(data)` se llama en cada `gameLogicFrame` (unas 12 veces por segundo) y en cada `roundTimeUpdate`. HUD compara con el valor anterior y solo toca el DOM si algo cambió.
- `HUD.update` acepta en cada jugador el campo **extensión** `immuneUntil` (marca de tiempo en ms del fin del escudo, tomada de `activeConsumable.endTime`).
- `HUD.show()`: `.hud-bar` entra desde `translateY(-16px)` y el marcador con filas escalonadas, 520 ms. `HUD.hide()`: opacidad a 0 en 240 ms y luego oculto.
- El HUD es visible solo en modo game (incluido como espectador).

### 6.4 Móvil (hasta 1023 px)

- `.hud-bar` de 48 px sobre la arena: a la izquierda la meta en 12 px; en el centro el temporizador a 44 px con la cifra en 18 px; a la derecha el largo propio (punto de color y cifra MONO) o el badge de espectador. El escudo propio reemplaza al largo mientras dura.
- `.hud-board` debajo de la arena como fila horizontal con scroll (`overflow-x: auto`, `scroll-snap-type: x proximity`): chips de 32 px con punto, nombre truncado a 8 caracteres y puntaje. El chip propio tiene borde lima y queda siempre visible (si está fuera de vista, se fija al final de la fila). Caption oculta.

## 7. Accesibilidad y rendimiento

### 7.1 Rendimiento

Objetivo: 60 FPS con 8 serpientes de unos 60 segmentos más partículas, en una laptop de gama media. Presupuesto por frame: arena hasta 6 ms, fondo vivo hasta 2 ms en partida (a 30 fps), actualización de partículas hasta 1 ms con 600 activas.

- Prohibido `shadowBlur` en el render por frame. Brillo con sprites cacheados y `'lighter'`.
- Sin allocations por frame en arena, partículas y fondo vivo (sección 5.3).
- Tope duro de partículas: arena 600; fondo vivo 202 estrellas y motas más 100 partículas de efecto (114 y 60 con `pointer: coarse`).
- `devicePixelRatio` máximo 2 en la arena; el fondo vivo trabaja a media resolución (0,35 en partida).
- El fondo vivo baja a 30 fps en partida y se detiene con `document.hidden`. La arena no se dibuja cuando su escena no está visible (lobby, login).
- Calidad adaptativa de la arena (5.17).
- Prohibido `backdrop-filter` en paneles persistentes (el fondo de abajo cambia cada frame y obligaría a recalcular el desenfoque). Permitido solo en `.modal` y `#finalScreen`, con un máximo de 8 px, desde 769 px y sin `pointer: coarse`.
- `filter: blur()` solo durante transiciones, sobre contenedores de escena o piezas de overlay, y se retira al terminar.
- INTEGRADOR no reconstruye `#playerList` en cada frame (hoy lo hace en `SnakeGame.js:1574`): en partida el marcador vivo es el HUD.
- Animaciones DOM solo sobre `transform`, `opacity` y `filter`; nunca sobre `width`, `height`, `top` o `left`, salvo la barra de largo del marcador y el colapso de altura de los toasts.

### 7.2 Accesibilidad

- Contraste: los pares de la sección 2.1. Nombres sobre la arena con contorno oscuro y tamaño mínimo de 10 px CSS. Nada interactivo por debajo de 14 px.
- El color nunca es la única señal: patrón de estrellitas del cuerpo por jugador (5.4), etiqueta "Tú" y pulso alrededor de la cabeza propia, nombres en la arena, icono además del color para el escudo.
- Movimiento reducido: tabla 3.6. Fotosensibilidad: máximo 3 destellos por segundo, siempre locales, alpha máximo 0,7 (0,25 con movimiento reducido).
- `prefers-contrast: more`: paneles con alpha 0,96, `--bio-ink-3` pasa a valer `--bio-ink-2`, sin nebulosa en la arena.
- Teclado: todo se puede operar con Tab, Enter y Escape. Foco visible (3.4). El modal atrapa el foco. Las escenas inactivas tienen `inert`.
- Lectores de pantalla: `<html lang="es">`; toasts con `role="status"` o `role="alert"`; `#overlay-round` con `aria-live="polite"` (anuncia "Gana la última en pie o la más larga, ¡Ya!"); el temporizador del HUD con `aria-label` y sin `aria-live` (sería ruido cada segundo); `#gameOverScreen` y `#finalScreen` con `role="dialog"` y `aria-labelledby`; el canvas con `aria-label="Arena de juego"`.
- Táctil: objetivos de 44 × 44 px como mínimo; `touch-action: none` en la arena.
- Las flechas, WASD y Espacio solo hacen `preventDefault` en partida, jugando y sin ser espectador (como hoy, `SnakeGame.js:745-769`), para no romper el scroll ni los inputs.
- Escapar HTML: todo nombre de usuario, código de sala o texto que llegue del servidor se pone con `textContent`. Hoy hay `innerHTML` con nombres sin escapar en `SnakeGame.js:1353-1363` (salas), `1656-1661` (final) y `1781-1787` (ranking); el rediseño los reemplaza.

## 8. Copia

Responsables: LAYOUT (textos estáticos del HTML), INTEGRADOR (textos generados), ESCENAS (overlays, HUD, toasts propios). Todos los textos van en español con tildes y signos de apertura, tuteo (el mismo registro que usa el servidor en sus mensajes en español), mayúscula inicial y sin emojis. Los números de segundos con decimales usan coma ("3,2 s"); el porcentaje lleva espacio ("60 %").

### 8.1 Intro y login

| Elemento | Texto |
|---|---|
| `<title>` | Snake Multiplayer |
| `.intro-title`, wordmarks | snake |
| `.intro-tagline`, línea de login | Multijugador en tiempo real |
| `.intro-prompt` (teclado) | Pulsa cualquier tecla para entrar en órbita |
| `.intro-prompt` (`pointer: coarse`) | Toca la pantalla para entrar en órbita |
| `.intro-prompt` (sin destino aún) | Conectando… |
| Saludo con sesión | Hola de nuevo, {nombre} |
| `label[for=username]` | Tu nombre |
| `#username` placeholder | Cómo te verán los demás |
| `.field-help` | Entre 2 y 20 caracteres. Con el mismo nombre recuperas tu perfil. |
| `#joinButton` / cargando | Entrar / Entrando… |
| `#loginLeaderboardButton` | Ver ranking global |

### 8.2 Perfil, lobby y dock

| Elemento | Texto |
|---|---|
| `.profile-chip-meta` | {n} victorias (1 victoria) |
| `dt` del perfil | Partidas / Victorias / Racha actual / Mejor puntaje |
| `#leaderboardButton` | Ranking global |
| `#resetProfileButton` | Cerrar sesión |
| Título del lobby | Salas |
| `#createRoomButton` | Crear sala |
| `label[for=roomId]` / placeholder | Código de sala / ABC123 |
| `#joinRoomButton` | Unirse |
| Título de la lista | Salas abiertas |
| `#refreshRoomsButton` | Actualizar |
| Lista cargando | Buscando salas… |
| Lista vacía | No hay salas abiertas. Crea una y comparte el código. |
| `.room-host` | Anfitrión: {nombre} |
| `.room-capacity` (`aria-label`) | {n} de {max} jugadores |
| `.room-live` | En juego |
| `.room-config` | Partida de {duración}, nivel {fácil, medio, difícil} (duración: "2 min", "1 min 30 s", "10 s") |
| Acciones de sala | Unirse / Mirar / Llena |
| Título del dock, `#dockToggle` | En línea |
| Dock vacío / cargando | No hay nadie más en línea / Buscando jugadores… |
| Estados | Disponible / En partida |
| `.invite-button` / tras invitar | Invitar / Enviada |

### 8.3 Sala

| Elemento | Texto |
|---|---|
| `#roomInfo` | Sala {código} + Eres el anfitrión (o Anfitrión: {nombre}) |
| `#roomInfo` espectador | Sala {código} + Estás mirando como espectador |
| Título de jugadores | Jugadores ({n} de {max}) |
| `.player-host` | Anfitrión |
| `#waitingSpan` | Faltan {n} jugadores para empezar (Falta 1 jugador para empezar) |
| `#waitingSpan` (alcanza el mínimo, no soy anfitrión) | Esperando a que el anfitrión inicie la partida |
| `#startGameButton` | Iniciar partida |
| `#toggleConfigButton` | Configuración (anfitrión) / Ver configuración (invitados) |
| Leyenda de `#difficultyPicker` | Nivel |
| Opciones de nivel (nombre y pista) | Fácil: Más lenta y con más comida / Medio: Equilibrado / Difícil: Más rápida, con disparos veloces |
| `.config-info` | El escudo de inmunidad bloquea un disparo y se gasta. |
| `.controls-hint` `player` | Muévete con Flechas / WASD (dos a la vez, en diagonal) o con un mando. Espacio, Clic o A del mando para disparar: cada disparo cuesta un segmento. |
| `.controls-hint` `spectator` | Estás viendo la partida en vivo. |
| `.controls-hint` `touch` | La partida se juega con el teléfono en horizontal. Apoya el pulgar en cualquier parte de la pantalla y arrástralo hacia donde quieras ir; el botón de la derecha dispara: cada disparo cuesta un segmento. |
| `#spectatorBanner` | Modo espectador |

### 8.4 Partida, overlays y ranking

| Elemento | Texto |
|---|---|
| HUD meta | Última en pie o la más larga |
| HUD temporizador | {m}:{ss} desde un minuto, {s} debajo (`aria-label`: "{m} minutos y {s} segundos") |
| HUD caption | Largo actual |
| HUD fila propia, etiqueta en arena | Tú |
| HUD escudo | Escudo {x,y} s |
| HUD espectador | Espectador |
| Cuenta regresiva | Gana la última en pie o la más larga, luego 3, 2, 1 |
| Inicio de la partida | Gana la última en pie o la más larga, ¡Ya! |
| `#finalTitle` | {nombre del ganador} (en empate, "Empate"; o "Sala cerrada") |
| `#finalMessage` | Última en pie, con {n} segmentos. / Gana con la serpiente más larga: {n} segmentos. / En empate: {A} y {B} terminan con {n} segmentos. / Si caen a la vez: {A} y {B} caen a la vez. (singular: 1 segmento) |
| Título de la clasificación | Clasificación final |
| `.final-total` | {n} segmentos (1 segmento); si quedó fuera, "fuera" |
| `#finalHint` | {anfitrión} puede iniciar otra partida / Falta 1 jugador para jugar de nuevo / Faltan {n} jugadores para jugar de nuevo |
| `#playAgainButton` | Jugar de nuevo |
| `#backToRoomButton` | Volver a la sala |
| `#backToMenuButton` | Salir a las salas (espectador: Volver a las salas) |
| `#leaveRoomButton` | Salir de la sala |
| Título del modal | Ranking global |
| `.leaderboard-head` | Jugador / Victorias / Partidas / Efectividad |
| `.winrate` | {p} % |
| Ranking cargando / vacío | Cargando ranking… / Todavía no hay partidas registradas. |
| `.leaderboard-note` | Primero quienes jugaron 3 partidas o más, ordenados por porcentaje de victorias. |
| `#closeLeaderboardModal` (`aria-label`) | Cerrar |
| Pie | Hecho con [icono de corazón] por El Marto |
| Textos flotantes en la arena | +{n} / -{n} (con U+2212) / cabeza / Fuera / Bloqueado |

El orden del ranking descripto en la nota es el que aplica hoy `SnakeGame.js:1747-1776`.

### 8.5 Toasts

Reemplazo de cada `addCanvasNotification` actual. "Sin toast" significa que el cambio ya lo comunica la escena o un overlay.

| Disparador | Texto | Tipo |
|---|---|---|
| Conexión inicial | Sin toast | |
| `disconnect` | Se perdió la conexión con el servidor | error |
| `gameError` | Traducción de 8.6 | error |
| `roomCreated` | Sala {código} creada. Comparte el código para invitar. | success |
| `roomJoined` | Entraste a la sala {código} | success |
| `newHost` (soy yo) | Ahora eres el anfitrión de la sala | info |
| Faltan jugadores (`updatePlayers`) | Sin toast (lo dice `#waitingSpan`) | |
| `configUpdated` | Configuración actualizada | success |
| `gameStart`, `countdown`, `roundEnd`, `gameEnd` | Sin toast (overlays) | |
| `spectatingStarted` | Mirando la sala {código} | info |
| `spectatorJoined` | {nombre} está mirando la partida | info |
| `consumableEvents` (soy yo) | Escudo activo: bloquea un disparo / Boca grande: comés desde más lejos / Abanico: tus próximos 3 disparos salen de a tres | success, 2500 ms |
| `gameState.frenzy` (empieza) | Frenesí: más comida hasta el final | info, 3000 ms |
| `hitEvents` con `eliminated` (soy yo) | Quedaste fuera: sigues mirando hasta el final | info, 3500 ms |
| `hitEvents` con `eliminated` (otra) | {atacante} dejó fuera a {víctima} / {víctima} quedó fuera (con su propio disparo) | info, 2500 ms |
| Eliminación que termina la partida | Sin toast (lo cuenta el final) | |
| `gamepadconnected` | Mando conectado: stick o cruceta para moverte, A o gatillo derecho para disparar | info, 3500 ms |
| `gamepaddisconnected` | Mando desconectado | info, 2500 ms |
| `consumableEvents` (otro) | Sin toast | |
| `profileLoaded` | Sin toast (lo dice la intro o la escena) | |
| `backToMenuSuccess` | Sin toast | |
| `invitationSent` | Invitación enviada a {nombre} | success |
| `invitationReceived` | {nombre} te invita a la sala {código} | invitation, acción "Unirse" |
| Invitar durante una partida | No puedes invitar durante una partida | error |
| Guardar sin ser anfitrión | Solo el anfitrión puede cambiar la configuración | error |
| Mínimo mayor que máximo | El mínimo de jugadores no puede superar al máximo | error |
| Mirar sin sesión | Inicia sesión para mirar partidas | error |
| Cerrar sesión | Sesión cerrada | info |
| Nombre inválido | El nombre debe tener entre 2 y 20 caracteres | error |
| Código inválido | El código de sala tiene 6 caracteres | error |

La acción "Unirse" de la invitación pone el código en `#roomId` (como hoy) y ejecuta el mismo camino que `#joinRoomButton`. Hoy la invitación enviada genera dos toasts (`SnakeGame.js:385` y `1243`); queda solo el de `invitationSent`.

### 8.6 Mensajes del servidor

El servidor envía varios errores en inglés y el cambio en el servidor es solo aditivo, así que INTEGRADOR los traduce en el cliente antes de llamar a `Toasts.show`. Los mensajes que ya llegan en español pasan sin cambios.

```js
const SERVER_ERRORS_ES = {
  'Username must be 2-20 characters': 'El nombre debe tener entre 2 y 20 caracteres',
  'Failed to create room': 'No se pudo crear la sala. Intenta de nuevo.',
  'Error creating room': 'No se pudo crear la sala. Intenta de nuevo.',
  'Invalid room ID': 'El código de sala no es válido',
  'Room not found or has ended': 'No hay una sala abierta con ese código',
  'Room is full': 'La sala está llena',
  'Game already in progress': 'La partida ya empezó. Puedes mirarla desde la lista de salas.',
  'Username already taken in this room': 'Ya hay alguien con ese nombre en la sala',
  'Error joining room': 'No se pudo entrar a la sala. Intenta de nuevo.',
  'Only the host can modify room settings': 'Solo el anfitrión puede cambiar la configuración',
  'Cannot modify settings during game': 'No se puede cambiar la configuración durante la partida',
  'Only the host can start the game': 'Solo el anfitrión puede iniciar la partida',
  'Not enough players to continue': 'No quedan jugadores suficientes para seguir',
  'Error loading profile': 'No se pudo cargar el perfil',
};
// Con número variable: /^Need at least (\d+) players$/ se traduce a 'Se necesitan al menos $1 jugadores'
```

## 9. Eventos del servidor

Responsable: SERVIDOR. Todo es aditivo: no cambia ningún campo existente ni el orden de la lógica. Los cinco arrays nuevos de `gameLogicFrame` están siempre presentes, vacíos si no pasó nada. Todas las coordenadas son de celda (esquina superior izquierda), igual que `segments`.

- **`foodEvents`**: se agrega en el bloque de comida de `gameLogicLoop` (`index.js:947-976`) cuando se come: `{ playerId: player.id, x: eatenFood.x, y: eatenFood.y, score: eatenFood.score, color: player.color }`.
- **`hitEvents`**: en `moveProjectiles` (`index.js:651-663`), cuando un proyectil impacta un segmento sin inmunidad: `{ targetId: player.id, attackerId: projectile.playerId, x: segment.x, y: segment.y, segmentsLost, headshot: i === 0, color: player.color, attackerColor: projectile.color }`. `segmentsLost` es la cantidad realmente quitada: con daño fijo, `min(hitDamage, largo)`. Si la víctima quedó sin segmentos, el evento suma `eliminated: true` (`docs/GAMEPLAY_SPEC.md`, etapa 5); `headshot` queda solo para el efecto.
- **`blockEvents`**: en el mismo lugar, cuando la inmunidad bloquea (`index.js:645-649`): `{ playerId: player.id, attackerId: projectile.playerId, x: segment.x, y: segment.y }`.
- **`projectileEvents`**: el disparo ocurre entre ticks (handler `attack`, `index.js:1195-1208`), así que `createProjectile` agrega el evento a `room.pendingProjectileEvents` (inicializado en `createRoom`) con `{ id, playerId, x, y, direction, color }` (posición de salida) y `gameLogicLoop` lo envía y vacía en el siguiente frame. `startNewRound` también lo vacía.
- **`expiredProjectiles`**: en `moveProjectiles`, cuando el proyectil sale del mapa (`index.js:633-636`): `{ id, x, y }` con la posición anterior al último movimiento (la última celda dentro de la arena).
- **`portals`**: cada evento suma `fromX, fromY` (la cabeza antes de moverse, `prevHead`, `index.js:893`) y `toX, toY` (la cabeza después de envolver).
- **`consumableEvents`**: cada evento suma `x, y` del consumible recogido.

Detalle de orden útil para el cliente: `moveProjectiles` corre antes de mover a los jugadores (`index.js:883-885`), así que los impactos de un frame se refieren a las posiciones del frame anterior. Por eso INTEGRADOR despacha los eventos de un frame cuando el render lo alcanza, antes de dibujar sus posiciones.

## 10. Integración

Responsable: INTEGRADOR. Esta sección resume lo que cambia en `SnakeGame.js` para conectar los módulos.

**Arranque.** `Backdrop.init(document.getElementById('backdrop'))`, `Arena.init(canvas)`, `Scenes.go('intro', { immediate: true })`. Con perfil guardado se pide el perfil como hoy y se navega en `profileLoaded`; sin perfil, `Scenes.go('login')` enseguida (queda en cola, 4.2).

**Bucle de render.** Un único `requestAnimationFrame` siempre activo (reemplazó a `startRenderLoop` y `stopRenderLoop`, que detenían el dibujo al terminar). Por frame:

1. Si se está jugando la partida: posiciones de serpientes y proyectiles desde la línea de tiempo (`js/net/motion.js`), y `Arena.render(state, now)` con `state = { snakes, foods, consumables, projectiles: clientProjectiles, myId: socket.id, roundTimeLeft, playing, spectating: isSpectating }`.
2. Si la partida terminó y no pasaron 2400 ms: `Arena.render` con el último estado congelado.
3. En sala, debajo del final después del congelamiento, o con la escena 'game' sin partida: `Arena.renderIdle(now, { snakesPreview, caption })`, con `snakesPreview` armado a partir de `snakes` (id, name, color, `isMe`).
4. Si la escena actual no es 'room' ni 'game': no se dibuja la arena.

Al terminar, el servidor (`endMatch`) emite `gameEnd` y enseguida vuelve la sala a espera, así que el `updatePlayers` que sigue trae `playing` falso y serpientes de largo 3. El cliente marca `matchFinished` al recibir `gameEnd` y lo limpia con la siguiente `countdown` o `gameStart`; mientras está marcado, no vuelve a la sala por su cuenta (eso es solo para "No quedan jugadores suficientes") y el HUD conserva el resultado.

**`gameLogicFrame`**, en este orden: despachar `foodEvents`, `hitEvents`, `blockEvents`, `portals`, `projectileEvents`, `expiredProjectiles` y `consumableEvents` a sus hooks de Arena; aplicar jugadores, proyectiles, comida y consumibles (como hoy); llamar a `HUD.update`; si `roundTimeLeft` llegó a 10, `Backdrop.setMood('tension')`, y desde ahí `Backdrop.pulse('#EC4F5A', 0.15)` en cada segundo nuevo.

**Otros eventos**:

- `countdown`: `Overlays.countdown(count, state.round)`.
- `gameStart`: `Scenes.go('game')`, `Overlays.roundStart(round, 3)`, `Arena.setConfig(...)`, `Arena.onRoundStart()`, `HUD.show()`, `Backdrop.setMood('game')`.
- `roundEnd`: `Arena.onRoundEnd({ winnerId: data.winner ? data.winner.id : null })`, `Overlays.roundEnd(data, { colorsById })`, `HUD.update` con totales y `playing: false`, `Backdrop.setMood('game')` (sale de `tension`).
- `configUpdated`: `Arena.setConfig({ segmentSize, width, height })` con el tamaño del mundo que manda el servidor, igual que en `gameStart` y `spectatingStarted`.
- `gameEnd`: `Overlays.final(data, { colorsByName })`. `colorsByName` sale de `snakes` (los nombres son únicos dentro de una sala, `index.js:1087`) porque `finalScores` y `winner` no traen color ni id.
- `spectatingStarted`: como `gameStart` pero sin `onRoundStart` ni `roundStart`.
- `#backToMenuButton`: `Overlays.hideAll()` y `Scenes.go('lobby')` además de lo que hace hoy.
- `#leaderboardModal`: abrir y cerrar con `Overlays.open` y `Overlays.close`.

`colorsById` y `colorsByName` son mapas a color del servidor; Overlays los traduce con `Arena.bioColor`.

**Lo que se elimina**: `#infoCanvas` y todo su código (`drawInfoCanvas`, `infoCtx`), `CanvasNotification` y `addCanvasNotification` (reemplazados por `Toasts.show` con la copia de 8.5), `drawGrid`, `drawPlayers`, `drawRetro*`, `drawHexagon`, `drawLayeredConsumable`, `drawCountdown` y `gameLoop` (reemplazados por Arena), `handleResize` y las asignaciones `canvas.width = 600` (el tamaño lo dan el CSS y Arena), y la llamada a `updatePlayerList` dentro del bucle de render.

**Lo que se reescribe sin `innerHTML` con datos**: `updateRoomsList`, `updateRoomInfo`, `updateProfileDisplay`, `updateSpectatorIndicator` (pasa a cambiar `data-variant` de `.controls-hint`), `showFinalScreen` (lo hace Overlays), `showLeaderboard`. Los textos con emojis del JS actual se reemplazan por los de la sección 8 (botón de invitar, estados de jugador, botón de configuración, pistas de controles, lista de salas).

**Teclado**: Enter en `#username` envía; Escape cierra el modal y el popover de perfil (los cierra ESCENAS si están abiertos).

## 11. Fuera de alcance

- Audio.
- Cambiar los valores fijos del servidor (`maxRounds`, `roundTime`, tamaño de 600 × 600, `attacksEnabled`, `index.js:237-257`): la interfaz los muestra como fijos.
- Traducir los mensajes en inglés dentro del servidor: se resuelve en el cliente (8.6).
- Modificar `snakeClass.js`.
