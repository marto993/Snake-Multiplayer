# Especificación visual: abismo bioluminiscente

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

- La arena mide 600 × 600 píxeles lógicos. En las fórmulas, `s` es `segmentSize` (8, 10, 15, 20 o 25), y una medida como `0,5·s` significa 0,5 × `segmentSize` (con `s` igual a 20, son 10 px lógicos).
- Las coordenadas `x, y` de segmentos, comida, consumibles, proyectiles y eventos del servidor son la esquina superior izquierda de la celda. El centro es `(x + s/2, y + s/2)`.
- Las duraciones van siempre en milisegundos (ms). En los textos de interfaz, "s" significa segundos.
- "Escala de la arena" es `tamaño CSS del canvas / 600`. En un teléfono de 375 px de ancho vale 0,57.
- Los colores que no figuran como token se escriben en hex o `rgba()` explícito.

## 1. Concepto

La partida ocurre a cuatro mil metros de profundidad. Ahí no llega la luz del sol: todo lo que se ve lo emite algo vivo. Cada serpiente es una criatura abisal hecha de luz, con un núcleo casi blanco, un halo de su color, fotóforos que titilan a lo largo del cuerpo y un señuelo que se balancea delante de la cabeza, como el de un pez linterna. La comida es plancton que late, la inmunidad es una medusa que envuelve la cabeza, los disparos son pulsos de luz con estela. El agua tiene nieve marina en suspensión que se enciende cuando algo pasa cerca, igual que los dinoflagelados que iluminan las olas de noche.

La interfaz cuenta un descenso. La intro empieza cerca de la superficie, con los últimos haces de luz; cada pantalla siguiente está más abajo y más oscura, hasta la partida, donde solo quedan las criaturas. Las superficies de la interfaz no brillan: son membranas oscuras y translúcidas. La luz se reserva para lo que está vivo o espera una acción (el botón principal de cada escena, el jugador propio, el temporizador, una invitación). En los menús el ritmo es lento e hipnótico; en la partida es nítido; en los últimos diez segundos el agua se enrojece y el pulso se acelera.

Referencias de la naturaleza: las floraciones de *Noctiluca scintillans* que vuelven azules las olas, los ctenóforos y sus bandas de cilios irisados, el señuelo del rape abisal, los sifonóforos coloniales filmados por MBARI y por el programa Okeanos de NOAA. Referencias de juegos: flOw (un organismo que crece comiendo en el océano, la referencia más cercana a esta mecánica), Abzû por la luz bajo el agua, Ori por el manejo de partículas y brillo. Queda afuera: neón urbano, scanlines, grillas de líneas, bordes duros de un píxel, mayúsculas sostenidas y paneles grises de tablero de control.

Principios que ordenan todas las decisiones:

- **La luz es vida.** Solo emite luz lo que está vivo o lo que espera una acción. Fondos, paneles y textos de soporte son oscuros y quietos.
- **Profundidad es progreso.** Cada escena está más abajo que la anterior: menos luz ambiental, más contraste de las criaturas.
- **Nada aparece en seco.** Toda entrada y salida de escena, overlay y toast se anima. Los elementos chicos que el código alterna con `.hidden` tienen animación de entrada (sección 4.20).
- **El movimiento responde.** La animación que no fue disparada por el usuario o por el juego se limita a la lista de la sección 3.5.

El momento firma es uno solo: **el agua reacciona**. En intro, login, lobby y sala, el puntero (o el dedo) enciende el plancton a su paso y deja una estela que se apaga en un segundo. En la arena de espera, cada criatura enciende la nieve marina cerca de su cabeza. Durante la partida no: esos destellos del color de cada serpiente se confundían con la comida. Es la única "magia" ambiental; lo demás se mantiene sobrio para que esto se note.

## 2. Tokens de diseño

Responsable de declararlos: LAYOUT, en `theme.css`, bajo `:root`. ARENA y ESCENAS usan los mismos valores en canvas (copiados como constantes, porque el canvas no lee variables CSS en cada frame).

### 2.1 Paleta

Los fondos son capas de abismo, del más profundo al más elevado. El azul abismo se usa en degradados y en luces lejanas, nunca como relleno plano de un panel.

| Token | Hex | Uso |
|---|---|---|
| `--bio-abyss-950` | `#010509` | Viñeta, inicio de la intro, sombras |
| `--bio-abyss-900` | `#020A12` | Fondo de página y de la arena (`body` lo declara explícito) |
| `--bio-abyss-800` | `#04121D` | Listas y zonas hundidas dentro de paneles |
| `--bio-abyss-700` | `#071B29` | Paneles (membranas), con alpha 0,86 |
| `--bio-abyss-600` | `#0B2738` | Inputs, filas elevadas, hover de filas |
| `--bio-abyss-500` | `#12384D` | Bordes fuertes, pips apagados, separadores |
| `--bio-deep-blue` | `#0C3D73` | Azul abismo: degradados del fondo, cáusticas profundas |
| `--bio-deep-blue-glow` | `#2A6FDB` | Brillo lejano: haces de luz, siluetas del fondo |

Las luces son los colores emitidos. Turquesa es la marca; lima es la acción.

| Token | Hex | Uso |
|---|---|---|
| `--bio-turquoise` | `#1FF2D2` | Marca, foco, bordes activos, temporizador en calma |
| `--bio-turquoise-soft` | `#8AF7E6` | Texto de acento, botones secundarios |
| `--bio-cyan` | `#4FD8FF` | Información, cáusticas, grilla |
| `--bio-lime` | `#C8FF3C` | Botón principal, éxito, "¡Ya!", jugador propio en listas |
| `--bio-lime-soft` | `#E4FF9A` | Texto con tono lima sobre oscuro |
| `--bio-pearl` | `#E8FBFF` | Núcleos de luz, anillo de sonar del jugador propio |
| `--bio-shield` | `#9FF4FF` | Inmunidad: medusa, burbujas, icono de escudo |

Estados y texto:

| Token | Hex | Uso |
|---|---|---|
| `--bio-warning` | `#FFB547` | Temporizador entre 20 y 11 segundos, avisos |
| `--bio-danger` | `#FF4D6D` | Errores, tensión, temporizador desde 10 segundos |
| `--bio-danger-soft` | `#FF8FA3` | Texto de error sobre `abyss-600` o más claro |
| `--bio-invite` | `#A98BFF` | Invitaciones, modo espectador |
| `--bio-ink` | `#E2F6FA` | Texto principal |
| `--bio-ink-2` | `#A3C7D1` | Texto secundario |
| `--bio-ink-3` | `#7397A5` | Metadatos; prohibido sobre `abyss-500` |
| `--bio-ink-on-lime` | `#05230F` | Texto sobre botones lima |
| `--bio-ink-on-turquoise` | `#012A26` | Texto sobre relleno turquesa |
| `--bio-ink-on-invite` | `#14063A` | Texto sobre relleno violeta |

`--bio-success` es un alias de `--bio-lime` y `--bio-info` es un alias de `--bio-cyan`.

Contrastes medidos con la fórmula WCAG 2.1 (todos los pares de uso real superan 4,5:1):

| Par | Contraste |
|---|---|
| `ink` sobre `abyss-700` | 15,7:1 |
| `ink-2` sobre `abyss-700` | 9,7:1 |
| `ink-3` sobre `abyss-700` / `abyss-600` | 5,6:1 / 4,9:1 |
| `ink-3` sobre `abyss-500` | 3,9:1 (no usar) |
| `danger` sobre `abyss-700` / `abyss-500` | 5,5:1 / 3,8:1 (sobre 500 usar `danger-soft`, 5,7:1) |
| `invite` sobre `abyss-700` | 6,5:1 |
| `ink-on-lime` sobre `lime` | 14,2:1 |
| `ink-on-turquoise` sobre `turquoise` | 10,8:1 |

Los paneles son translúcidos sobre un fondo animado. Para que el contraste medido se sostenga, el alpha de un panel nunca baja de 0,86 y el fondo vivo no pone partículas de más de 2 px detrás de texto (las partículas "cercanas" del fondo son desenfocadas y de alpha ≤ 0,12).

### 2.2 Glow

El brillo de la interfaz DOM se construye con `box-shadow` y `text-shadow`, nunca con `filter: blur()` sobre elementos grandes.

| Token | Valor |
|---|---|
| `--bio-glow-turquoise` | `rgba(31, 242, 210, 0.35)` |
| `--bio-glow-lime` | `rgba(200, 255, 60, 0.30)` |
| `--bio-glow-cyan` | `rgba(79, 216, 255, 0.30)` |
| `--bio-glow-danger` | `rgba(255, 77, 109, 0.35)` |
| `--bio-glow-invite` | `rgba(169, 139, 255, 0.35)` |
| `--bio-glow-pearl` | `rgba(232, 251, 255, 0.30)` |

Receta para un elemento que brilla: `box-shadow: 0 0 0 1px <color al 50 %>, 0 0 24px <glow>`. Receta para texto display (36 px o más): `text-shadow: 0 0 2px <color al 60 %>, 0 0 18px <glow>`. Prohibido `text-shadow` con glow en texto de menos de 36 px: ensucia la lectura. En canvas el glow se hace con sprites (sección 5.3).

### 2.3 Colores de jugador

Responsable: ARENA implementa `Arena.bioColor(hex)` (**extensión**). ESCENAS e INTEGRADOR la usan para todo color de jugador en DOM. Nadie modifica el servidor.

El servidor asigna 16 colores fijos en orden (`index.js:37-41`): verde, magenta, cian, amarillo, rojo, violeta, menta, naranja y ocho variantes más. Son neones saturados pensados para el estilo anterior. Sobre `#020A12` el azul `#4040ff` da 3,2:1 y el violeta `#8040ff` 3,9:1, y varios pares son casi iguales: la distancia OKLab mínima entre los 16 es 0,045 (`#ff0080` contra `#ff4080`). Aclararlos de forma uniforme empeora el problema, porque los pares rojo y rosa colapsan a casi el mismo tono.

La decisión: el color del servidor es solo una clave. El cliente lo traduce a un equivalente bioluminiscente curado, y todas las superficies (arena, HUD, listas, overlays, final) usan la versión traducida, de modo que el punto del marcador coincide con la criatura. Con la tabla curada, la distancia mínima entre los primeros 8 colores (los que aparecen en partidas de hasta 8 jugadores) sube de 0,057 a 0,086, la mínima entre los 16 sube de 0,045 a 0,065, y el contraste mínimo contra el fondo de la arena sube de 3,2:1 a 5,8:1. Todos los `text` superan 11,8:1 sobre `abyss-700`.

```js
// Clave: color exacto que envía el servidor (minúsculas). slot = posición en PLAYER_COLORS.
const BIO_PLAYER = {
  '#00ff41': { slot: 0,  body: '#7DFF6A', core: '#E5FDE1', deep: '#0B4B01', text: '#ABECA1' },
  '#ff0080': { slot: 1,  body: '#FF5FC8', core: '#FEF1F8', deep: '#6E0051', text: '#FEC3E5' },
  '#00ffff': { slot: 2,  body: '#3FE9FF', core: '#E1FBFF', deep: '#00464E', text: '#6FEDFF' },
  '#ffff00': { slot: 3,  body: '#FFE45C', core: '#FDF6D4', deep: '#483D01', text: '#ECD877' },
  '#ff4040': { slot: 4,  body: '#FF5E5E', core: '#FEF2F1', deep: '#770213', text: '#FEC8C4' },
  '#8040ff': { slot: 5,  body: '#A884FF', core: '#F5F3FF', deep: '#442879', text: '#DAD0FE' },
  '#40ff80': { slot: 6,  body: '#3DFFB8', core: '#DCFFED', deep: '#004931', text: '#87F1C1' },
  '#ff8040': { slot: 7,  body: '#FF9A4D', core: '#FFF2EB', deep: '#5F2E01', text: '#FFCBA9' },
  '#4080ff': { slot: 8,  body: '#5C9DFF', core: '#F0F6FE', deep: '#0D3A7A', text: '#C1D9FE' },
  '#ff40ff': { slot: 9,  body: '#E36BFF', core: '#FCF1FE', deep: '#610173', text: '#F3C4FF' },
  '#80ff40': { slot: 10, body: '#C3FF4A', core: '#EDFBDB', deep: '#314500', text: '#C3E68E' },
  '#ff4080': { slot: 11, body: '#FF7A9C', core: '#FFF1F3', deep: '#6E1533', text: '#FFC6D1' },
  '#4040ff': { slot: 12, body: '#7E7BFF', core: '#F3F4FE', deep: '#342C85', text: '#D0D4FE' },
  '#ffff80': { slot: 13, body: '#FFF3A8', core: '#FCF7D4', deep: '#463E06', text: '#E6DA8F' },
  '#80ffff': { slot: 14, body: '#A6FFF4', core: '#D7FFF9', deep: '#034742', text: '#92EBE0' },
  '#ff8080': { slot: 15, body: '#FFB0A0', core: '#FEF2F0', deep: '#5D2D24', text: '#FFC9BD' },
};
```

Significado de cada campo:

- **body**: color del cuerpo, del halo y del punto en listas.
- **core**: núcleo casi blanco teñido; filamento central, ojos, bulbo del señuelo.
- **deep**: tono oscuro; final de la cola, tinta del impacto en la cabeza.
- **text**: nombres sobre fondo oscuro (etiquetas en la arena, filas del HUD).
- **slot**: elige el patrón de fotóforos (sección 5.4), para que dos jugadores de color parecido se distingan también por forma.

`Arena.bioColor(hex)` normaliza a minúsculas y devuelve el objeto de la tabla (siempre el mismo objeto, sin crear uno nuevo por llamada). Para un color desconocido (el servidor hoy no puede enviarlo, ver `index.js:43-52`) calcula en HSL conservando el tono: body con saturación 100 % y luminosidad 68 %, core con luminosidad 95 %, deep con 22 %, text con 84 %, y slot igual a la suma de los códigos de caracteres del hex módulo 4. El resultado se cachea por hex.

### 2.4 Tipografía

Dos familias de Google Fonts cubren los tres roles pedidos (display, interfaz y cifras):

- **Display: Fraunces, solo itálica.** Es una serif variable con eje `SOFT` (redondea terminales) y `WONK` (inclina letras de forma irregular). Con SOFT 100 y WONK 1 las letras parecen blandas, gelatinosas, como tejido de medusa; la itálica sugiere nado. Con peso 200 a 340 los trazos son finos y el halo de `text-shadow` se lee como filamento luminoso. Uso: título de la intro, wordmark, títulos de overlays, número de la cuenta regresiva, nombre del campeón, contador gigante de la arena. Nunca por debajo de 32 px (el corte cargado es el óptico de 144, que a tamaños chicos se vuelve frágil).
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

Las formas son orgánicas: los paneles principales usan radios asimétricos, como una membrana. La jerarquía se lee en el radio; no todo lleva el mismo.

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
  /* abismo */
  --bio-abyss-950:#010509; --bio-abyss-900:#020A12; --bio-abyss-800:#04121D;
  --bio-abyss-700:#071B29; --bio-abyss-600:#0B2738; --bio-abyss-500:#12384D;
  --bio-deep-blue:#0C3D73; --bio-deep-blue-glow:#2A6FDB;
  --bio-panel: rgba(7, 27, 41, 0.86);
  --bio-panel-border: rgba(31, 242, 210, 0.16);
  /* luz */
  --bio-turquoise:#1FF2D2; --bio-turquoise-soft:#8AF7E6; --bio-cyan:#4FD8FF;
  --bio-lime:#C8FF3C; --bio-lime-soft:#E4FF9A; --bio-pearl:#E8FBFF; --bio-shield:#9FF4FF;
  /* estado */
  --bio-success:var(--bio-lime); --bio-info:var(--bio-cyan);
  --bio-warning:#FFB547; --bio-danger:#FF4D6D; --bio-danger-soft:#FF8FA3; --bio-invite:#A98BFF;
  /* texto */
  --bio-ink:#E2F6FA; --bio-ink-2:#A3C7D1; --bio-ink-3:#7397A5;
  --bio-ink-on-lime:#05230F; --bio-ink-on-turquoise:#012A26; --bio-ink-on-invite:#14063A;
  /* glow */
  --bio-glow-turquoise:rgba(31,242,210,.35); --bio-glow-lime:rgba(200,255,60,.30);
  --bio-glow-cyan:rgba(79,216,255,.30); --bio-glow-danger:rgba(255,77,109,.35);
  --bio-glow-invite:rgba(169,139,255,.35); --bio-glow-pearl:rgba(232,251,255,.30);
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

Todo se mueve como en el agua: acelera rápido y frena largo, sin rebotes secos. Las entradas usan `--bio-ease-out` (frenado largo, como algo que deriva hasta detenerse); las salidas usan `--bio-ease-in` (se hunde y se va); los cambios cíclicos usan `--bio-ease-in-out`. El rebote (`--bio-ease-jelly`) se reserva para cosas que "laten" una vez: números de cuenta regresiva, "¡Ya!", pips del HUD. Una salida dura entre la mitad y dos tercios de la entrada correspondiente. Las animaciones de entrada combinan opacidad, desplazamiento corto (12 a 36 px) y, en piezas grandes, un desenfoque que se aclara (de 6 a 10 px a 0), como algo que sube desde aguas turbias.

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

- **Botón principal** (relleno lima): hover sube 1 px y aumenta el glow de 0,25 a 0,40 en 180 ms; presionado escala a 0,97 en 90 ms; al soltar vuelve con `--bio-ease-jelly` en 240 ms.
- **Botón secundario** (borde turquesa): hover rellena con `rgba(31,242,210,0.08)` y el borde pasa de alpha 0,45 a 0,8.
- **Foco visible** en todo elemento interactivo: `outline: 2px solid var(--bio-turquoise); outline-offset: 3px; box-shadow: 0 0 0 6px rgba(31,242,210,0.18)`. Solo con `:focus-visible`.
- **Filas de lista** (salas, jugadores en línea): hover cambia el fondo a `abyss-600` y enciende el punto de la fila (alpha 0,6 a 1) en 180 ms. Las filas no se desplazan ni escalan en hover.
- **Inputs**: foco cambia el borde a turquesa y suma el anillo de foco. Error de validación: el borde pasa a `danger` y el input hace una ondulación horizontal de 3 px, 2 ciclos en 320 ms (omitida con movimiento reducido).

### 3.5 Animaciones en reposo permitidas

Solo estas animaciones corren sin que nadie las dispare. Todo lo demás está quieto hasta que algo ocurre.

- El fondo vivo (`#backdrop`) y la arena en modo atracción.
- La respiración del botón principal de la escena activa (un solo botón por escena): glow entre 0,18 y 0,32 en `--bio-dur-breath`, `--bio-ease-in-out`, alternado e infinito. Botones principales por escena: login `#joinButton`, lobby `#createRoomButton`, sala `#startGameButton` (solo cuando está visible), final `#backToMenuButton`.
- El título de la intro: peso entre 260 y 340 en `--bio-dur-breath-slow`.
- Los puntos de estado de jugadores en línea disponibles: opacidad entre 0,55 y 1, ciclo de 2400 a 4000 ms con desfase aleatorio por fila.
- El borde de la arena: alpha de la membrana entre 0,08 y 0,12 en `--bio-dur-breath-slow`.
- El indicador de escudo del HUD mientras dura la inmunidad y el temporizador desde los 10 segundos.

### 3.6 Movimiento reducido

Con `prefers-reduced-motion: reduce` cada módulo aplica esta tabla. ESCENAS y ARENA leen la preferencia con `matchMedia` y escuchan sus cambios.

| Elemento | Normal | Reducido |
|---|---|---|
| Transición de escena | Inmersión de 900 ms con desplazamiento y desenfoque | Fundido de opacidad de 200 ms |
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

### 4.3 Transición estándar: inmersión

Toda transición entre escenas distintas usa esta coreografía, salvo las indicadas en 4.6 (salida de la intro), 4.11 (sala y partida) y 4.17 (entrada y salida del final).

1. La escena saliente pasa de opacidad 1 a 0, `translateY(0)` a `translateY(-28px)`, `scale(1)` a `scale(0.985)` y `blur(0)` a `blur(6px)`, en 420 ms con `--bio-ease-in`. Recibe `pointer-events: none` al empezar.
2. A los 180 ms de iniciada la salida, la escena entrante pasa de opacidad 0 a 1, `translateY(36px)` a 0, `scale(1.015)` a 1 y `blur(8px)` a 0, en 720 ms con `--bio-ease-out`.
3. Los hijos con `[data-stagger]` de la escena entrante entran escalonados: cada uno 60 ms después del anterior, desde `translateY(14px)` y opacidad 0, 560 ms con `--bio-ease-out`, empezando 120 ms después que la escena.
4. En el mismo instante del paso 1, el fondo vivo cambia de ambiente y recibe `Backdrop.pulse('#1FF2D2', 0.25)`. Si el destino está "más abajo" (orden: intro, login, lobby, room, game), el plancton del fondo recibe un empuje hacia arriba de 60 px/s que decae en 900 ms con `easeOutExpo`: se siente el descenso. Si el destino está más arriba (de final a lobby), el empuje es hacia abajo.

Duración total: 900 ms. El desenfoque se aplica solo a los contenedores de escena (no a la página entera) y con `will-change: transform, opacity, filter` puesto durante la transición y quitado al terminar.

### 4.4 Fondo vivo (Backdrop)

Responsable: ESCENAS (`backdrop.js`). Canvas `#backdrop` con `position: fixed; inset: 0`, `pointer-events: none`, detrás de todo.

Capas, de atrás hacia adelante:

1. **Degradado vertical**: del color superior del ambiente (tabla siguiente) a `#010509` abajo, con el 60 % inferior ya casi negro.
2. **Haces de luz**: 3 haces verticales inclinados 12°, sprite prerenderizado (degradado lineal de `--bio-deep-blue-glow` al 100 % arriba a 0 % al 70 % del alto, con borde horizontal suave), de 18 a 30 % del ancho de la pantalla, oscilando ±2 % de ancho en ciclos de 9 a 14 segundos. Alpha según ambiente.
3. **Plancton en tres profundidades**. Lejano: 90 partículas, 0,6 a 1,2 px, alpha 0,15 a 0,30, sube a 3 a 6 px/s. Medio: 50 partículas, 1,2 a 2,2 px, alpha 0,25 a 0,50, sube a 6 a 12 px/s. Cercano: 12 sprites desenfocados de 6 a 16 px, alpha 0,06 a 0,12, sube a 10 a 18 px/s. Las cantidades se multiplican por la densidad del ambiente. Color: 70 % turquesa o cian, 20 % lima, 10 % violeta. Cada partícula tiene un vaivén horizontal de ±6 px con período propio de 6 a 11 segundos.
4. **Destellos**: cada partícula lejana o media tiene una probabilidad de 0,03 por segundo de encenderse: sube a alpha 1 en 120 ms y vuelve a su valor en 600 ms.
5. **Siluetas lejanas** (solo intro, calm y lobby): 1 o 2 medusas prerenderizadas de 120 a 220 px, color `#0E3A52` con alpha 0,35, campana que late (escala vertical entre 0,92 y 1,04, ciclo de 4 segundos), cruzando la pantalla hacia arriba en unos 60 segundos.
6. **Estela del puntero** (el momento firma): con `pointermove` y `touchmove`, se emiten hasta 4 partículas por cada 16 ms a lo largo del recorrido (tope de 160 activas), turquesa con 20 % lima, vida de 900 a 1400 ms, 1 a 2,4 px, deriva lenta. Además, el plancton a menos de 90 px del puntero recibe un encendido proporcional a la velocidad del puntero (velocidad / 1200 px/s, tope 1), que decae en 900 ms. Activa solo en intro, calm, lobby y room; apagada con movimiento reducido.
7. **Pulsos**: `Backdrop.pulse(color, strength)` dibuja un degradado radial desde el centro de la pantalla que crece de radio 0 a 0,9 × el lado mayor en 900 ms, con alpha `strength × 0,35` que baja a 0, en modo `'lighter'`. Máximo 3 pulsos simultáneos (el más viejo se descarta).

Ambientes de `Backdrop.setMood(name, opts)`. `opts` es **extensión**: `opts.color` solo se usa en `celebration`. El cambio interpola todos los parámetros en 1200 ms con `easeInOutSine` (colores interpolados en RGB).

| Ambiente | Color superior | Densidad / velocidad | Extras |
|---|---|---|---|
| `intro` | `#06304A` | 0,6 / 1,0 | Haces 0,16, siluetas, estela |
| `calm` (login) | `#052538` | 0,8 / 0,8 | Haces 0,10, siluetas, estela |
| `lobby` | `#041D2E` | 1,0 / 1,0 | Haces 0,07, una silueta, estela |
| `room` | `#03141F` | 0,8 / 0,9 | Haces 0,04, estela |
| `game` | `#020C14` | 0,45 / 0,7 | Sin haces ni estela; 30 fps; resolución 0,35 |
| `tension` | `#1A0710` | 0,45 / 1,6 | Capa coral `rgba(255,77,109,0.12)` que late a 1 Hz; 30 fps |
| `celebration` | `#04283A` | 1,4 / 2,5 | 60 % del plancton en el color del campeón; 6 ráfagas de 40 partículas en puntos al azar durante 3 segundos; a los 6 segundos baja a densidad 1,0 y velocidad 1,0 |

Rendimiento del fondo vivo: el backing store mide la mitad del tamaño CSS (ignora `devicePixelRatio`; todo es suave y el escalado no se nota), 0,35 en `game` y `tension`. Tope de 260 partículas en total (150 con `pointer: coarse`). Con `document.hidden` se cancela el `requestAnimationFrame`; al volver se reinicia el delta de tiempo para que nada salte. Puede usar `Particles.createSystem({ max: 160 })` para la estela y las ráfagas de celebración.

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
- Iconos: SVG en línea, trazo de 1,75 px, extremos redondeados, `currentColor`, retícula de 20 px. Se necesitan: medusa (escudo), ojo (espectador), actualizar, cerrar, chevron, corazón (pie), y los tres logos del pie que ya existen. Sin emojis en ningún lugar.

### 4.6 Intro

Propósito: abrir en la oscuridad y mostrar en tres segundos de qué se trata. Layout: pantalla completa, todo centrado. Título `h1.intro-title` en Fraunces itálica a `--bio-fs-display`, color `--bio-turquoise-soft` con glow turquesa. Debajo, a 16 px, `p.intro-tagline` en Recursive 18 px `--bio-ink-2`. `p.intro-prompt` a 18vh del borde inferior, Recursive 16 px `--bio-ink`.

Secuencia completa (2800 ms), coordinada por ESCENAS entre `scenes.js` y `backdrop.js`:

1. **0 ms.** Pantalla `#010509`. Fondo vivo con densidad 0. Sin título.
2. **150 ms.** Un único punto de plancton se enciende al 40 % del ancho y 55 % del alto: sube en 120 ms, decae lento. Es el primer destello.
3. **400 a 1300 ms.** Cascada: 48 puntos se encienden en una espiral que se abre desde ese punto (retardo de cada uno = distancia / 0,45 px por ms, más un azar de ±60 ms). Colores: 70 % turquesa, 20 % lima, 10 % violeta. El degradado del fondo pasa de negro al color del ambiente `intro` en 1200 ms.
4. **900 a 2100 ms.** Una criatura de luz de 12 segmentos (cuerpo `#1FF2D2`, señuelo lima) entra por la izquierda al 35 % del alto, nada en una senoide (amplitud 40 px, longitud de onda 420 px) y sale por la derecha. Deja estela de plancton encendido. Se dibuja en `#backdrop`.
5. **1100 a 2200 ms.** El título se revela siguiendo a la criatura: `mask-image` con un degradado lineal de borde suave (30 % del ancho) cuya posición avanza de izquierda a derecha acompañando la x de la criatura. A la vez, el peso pasa de 200 a 300, el interletrado de 0,08em a -0,01em y el glow de 0 a pleno, todo con `--bio-ease-out`.
6. **2000 a 2500 ms.** La línea `p.intro-tagline` sube 10 px y aparece en 500 ms.
7. **2500 a 2800 ms.** Aparece `p.intro-prompt` y desde ahí respira (opacidad entre 0,55 y 1, ciclo de 2400 ms). El fondo llega a la densidad completa del ambiente y aparecen los haces de luz. Si hay saludo (`opts.greeting`), en lugar del aviso se muestra "Hola de nuevo, {nombre}" y se avanza solo a lobby a los 700 ms.

Versión corta: si `sessionStorage` tiene `bio.introSeen = "1"` (se escribe al terminar la primera intro; leer y escribir dentro de `try/catch`), la intro dura 900 ms: fondo de negro a `intro` y título con fundido y desenfoque de 8 px a 0 en 600 ms, sin cascada ni criatura. Con movimiento reducido: título y aviso con fundido de 400 ms.

Salida de la intro: el wordmark viaja. Scenes mide el destino `[data-wordmark-target]` de la escena siguiente (`.login-wordmark` en login, `#topbar .wordmark` en lobby) y anima el título de la intro con FLIP (traslación y escala) hasta ese rectángulo en 800 ms con `--bio-ease-in-out`; en los últimos 200 ms el título se desvanece y el destino aparece. El resto de la intro (tagline, aviso) sale con la inmersión estándar. El efecto de descenso del fondo se aplica igual.

### 4.7 Login

Propósito: pedir un nombre y nada más. Layout desktop y móvil: columna centrada de hasta 420 px de ancho, centrada verticalmente.

- `.login-wordmark`: Fraunces itálica 300 a 72 px (48 px por debajo de 480 px de ancho), `--bio-turquoise-soft` con glow. Debajo, Recursive 16 px `--bio-ink-2`: "Multijugador en tiempo real".
- `.login-card`: membrana (`--bio-panel`, borde 1 px `--bio-panel-border`, `--bio-radius-membrane`, padding 32 px; 24 px en móvil).
- `label[for=username]` Recursive 600 16 px; `#username` de 52 px de alto, 18 px; `p.field-help` 14 px `--bio-ink-3` debajo.
- `#joinButton`: botón principal lima de ancho completo, 52 px de alto, respira. Mientras se espera `profileLoaded` muestra "Entrando…" y queda deshabilitado (INTEGRADOR).
- `#loginLeaderboardButton`: botón silencioso (texto `--bio-ink-2`, subrayado en hover), centrado debajo.
- Enter dentro de `#username` dispara `#joinButton` (INTEGRADOR).

Entrada: inmersión estándar con `[data-stagger]` en wordmark, tarjeta y botón secundario.

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

**Chip de perfil (`#profileView` dentro de `#topbar`).** `#topbar` es una barra fija de 64 px (56 en móvil) sin fondo propio: el wordmark a la izquierda (Fraunces itálica 300, 32 px, turquesa suave) y el chip a la derecha. El chip es un `button.profile-chip` en forma de píldora de 44 px de alto con un orbe de 32 px (degradado radial de `--bio-turquoise` a `--bio-deep-blue`, inicial del nombre en Fraunces 18 px `--bio-ink-on-turquoise`), el nombre en Recursive 600 16 px y, en desktop, "{n} victorias" en 14 px `--bio-ink-3`. Clic o Enter abre `.profile-popover` (membrana `--bio-radius-lg`, 300 px, anclada debajo del chip): aparece con opacidad, `translateY(-8px)` a 0 y escala 0,98 a 1 en 360 ms con `--bio-ease-out`; Escape o clic afuera lo cierra en 240 ms. Contiene `#profileInfo` (estadísticas, ver 4.21) y `.profile-actions` con `#leaderboardButton` (secundario) y `#resetProfileButton` (silencioso, texto coral suave en hover). `aria-expanded` y `aria-controls` en el chip.

**Dock (`#dock` con `#onlinePlayersPanel`).**

- Desde 1280 px: columna fija a la derecha (`top: 80px; right: var(--bio-gutter); width: 280px; max-height: calc(100vh - 140px)`), membrana con scroll interno. `#dockToggle` oculto.
- Entre 769 y 1279 px: el dock se oculta y aparece `#dockToggle`, botón flotante abajo a la derecha (por encima del pie): píldora "En línea" con `#dockCount` (cantidad de filas de la lista, que INTEGRADOR actualiza). Al tocarlo, el dock entra como panel lateral derecho de 320 px desde `translateX(24px)` y opacidad 0 en 520 ms con `--bio-ease-out`, con una capa de fondo `rgba(1,5,9,0.5)` que cierra al tocarla.
- Hasta 768 px: igual, pero el dock es una hoja inferior de 60vh de alto, radio superior de 24 px, con una barra de agarre visual de 36 × 4 px, que entra desde `translateY(40px)`.
- Cuando llega una invitación con el dock cerrado, `#dockToggle` late una vez (escala 1,08 con `--bio-ease-jelly`) y su borde pasa a violeta durante 3 segundos.

### 4.10 Sala (room)

Propósito: esperar jugadores, configurar e invitar, con la arena ya viva. La arena muestra el modo atracción (5.15): cada jugador de la sala nada como criatura con su nombre. Cuando alguien entra, su criatura eclosiona; cuando sale, se disuelve.

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
- `#roomInfo`: código de sala en MONO 21 px turquesa suave y, debajo, el rol ("Eres el anfitrión" o "Anfitrión: {nombre}") en 14 px `--bio-ink-2`.
- `#playerList`: filas de 40 px con rango, punto del color bio del jugador (10 px con glow de su color), nombre, etiqueta "Anfitrión" si corresponde y, durante la partida, el largo actual (en la sala, la columna de puntaje queda vacía). Fila propia (`.current-player`): borde izquierdo de 3 px lima y nombre en `--bio-lime-soft`.
- `#startGameButton`: principal, ancho completo, respira solo cuando está visible.
- `#configPanel`: acordeón. `#toggleConfigButton` es la fila cabecera (texto y chevron que rota 180° en 240 ms, con `aria-expanded`); `#configSettings` se despliega con el revelado de 4.20. Adentro, `#difficultyPicker` (leyenda "Nivel") apila tres opciones de al menos 48 px de alto: nombre en `--bio-ink` y una pista en `--bio-ink-2` a 14 px, con `--bio-radius-md` y fondo `rgba(4, 18, 29, 0.6)`. El radio nativo queda oculto pero recibe el foco, que se ve como el anillo turquesa de los campos. La opción marcada lleva borde turquesa y glow suave. El anfitrión cambia de nivel con un toque, sin botón de guardar: el servidor reparte el nivel a toda la sala. Los invitados ven las opciones deshabilitadas, con opacidad 0,6 y cursor `not-allowed`.
- `.controls-hint`: tres variantes por `data-variant` (`player`, `spectator`, `touch`), cada una un párrafo que LAYOUT muestra u oculta por CSS. Las teclas van en `<kbd>` (fondo `abyss-600`, borde inferior de 2 px `abyss-500`, `--bio-radius-sm`, cifras MONO). INTEGRADOR elige la variante: `spectator` si mira, `touch` si `matchMedia('(pointer: coarse)')` y no hay teclado conocido, `player` en el resto.

Entre 1024 y 1279 px: dos columnas (izquierda de 260 px y centro); dock como botón flotante. Entre 769 y 1023 px: una columna centrada de hasta 640 px, con la arena arriba y `#gameInterface` debajo en dos columnas internas (jugadores a la izquierda, configuración a la derecha). Hasta 768 px: una columna; arena arriba a ancho completo; debajo, `#gameInterface`. `#startGameButton` queda `position: sticky; bottom: 12px` para que el anfitrión lo alcance sin scroll.

Tamaño de la arena (`--arena-size`), igual en sala y en partida para no redimensionar el canvas al cambiar de modo:

| Ancho de ventana | `--arena-size` |
|---|---|
| Hasta 768 px | `min(calc(100vw - 32px), 600px)` |
| 769 a 1023 px | `clamp(320px, min(calc(100vw - 48px), calc(100svh - 240px)), 640px)` |
| 1024 a 1279 px | `clamp(320px, min(calc(100vw - 340px), calc(100svh - 200px)), 680px)` |
| Desde 1280 px | `clamp(320px, min(calc(100vw - 680px), calc(100svh - 200px)), 760px)` |

`.arena-frame` mide `--arena-size` de lado, tiene `--bio-radius-arena`, `overflow: hidden` y sombra `0 0 0 1px rgba(31,242,210,0.18), 0 0 48px rgba(31,242,210,0.10), 0 30px 80px rgba(0,0,0,0.6)`. El canvas ocupa el 100 % del marco; su backing store lo maneja ARENA. En partida, el glow sube a 0,16; con `#scene-arena[data-phase="tension"]` el borde pasa a `rgba(255,77,109,0.35)` en 600 ms.

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
│ ┌ .hud-board ─┐│ Gana la más larga    (1:42)     Escudo │┌ #gameInterface┐│
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

**Controles táctiles.** `#touchControls`, fijo sobre la escena, visible para quien juega (no para quien mira) en pantallas táctiles desde la cuenta regresiva: joystick flotante que aparece donde se apoya el pulgar, en cualquier parte de la pantalla fuera del botón de disparo, sigue al dedo y en reposo queda tenue abajo a la izquierda; pide un rumbo absoluto. Botón de disparo de 88 px abajo a la derecha, con un área táctil 20 px más grande que el círculo, atenuado con menos de 2 segmentos. Mantenerlo apretado dispara en continuo, un pedido cada `shotCooldownMs` (5 por segundo), como la barra espaciadora. Encima, centrado, el botón del ancla de 64 px (56 en pantallas de 400 px de alto o menos), perla, con un área táctil 12 px más grande: anclada se enciende con un aro perla de 2 px y glow; recargando, el icono baja a 0,4 y un aro de 3 px se llena alrededor (`conic-gradient` con `--p`). Respetan `env(safe-area-inset-*)`. En el celular horizontal, el marcador de la columna derecha llega hasta 224 px antes del borde inferior, para no tapar los dos botones.

**Horizontal obligatorio en el celular.** Con `pointer: coarse` en vertical y la partida en pantalla, `#rotateHint` tapa todo con un teléfono que gira y "Gira el teléfono"; los controles táctiles no se muestran. Donde el navegador lo permite (Android), un botón pone pantalla completa y fija la orientación en horizontal.

### 4.13 Cuenta regresiva 3, 2, 1

Responsable: ESCENAS (`Overlays.countdown(n)`). `#overlay-countdown` cubre `.arena-frame` (`position: absolute; inset: 0`), `pointer-events: none`.

- Al primer número aparece un velo radial (`radial-gradient` de `rgba(1,5,9,0.55)` en el centro a `rgba(1,5,9,0.2)` en los bordes) con fundido de 300 ms. Arriba del número, la meta de la partida, "Gana la serpiente más larga", en Recursive 600 18 px `--bio-ink-2`.
- El número va en Fraunces itálica 300, tamaño `calc(var(--arena-size) * 0.42)`. Colores: 3 en `--bio-turquoise`, 2 en `--bio-cyan`, 1 en `--bio-lime`, con el glow de texto display.
- Cada número entra con escala 1,5 a 1, opacidad 0 a 1 y `blur(14px)` a 0 en 480 ms con `--bio-ease-out`. Detrás, un anillo (`span.countdown-ring`, borde de 2 px del mismo color) crece de 0,4 a 1,6 veces el tamaño del número mientras su opacidad baja de 0,6 a 0, en 900 ms.
- Cuando llega el número siguiente, el anterior sale con escala 1 a 0,7, opacidad a 0 y `blur(8px)` en 260 ms con `--bio-ease-in`, y el nuevo entra a la vez.
- Con cada número: `Backdrop.pulse('#1FF2D2', 0.2)`.

### 4.14 Inicio de la partida

Responsable: ESCENAS (`Overlays.roundStart()`) y ARENA (`Arena.onRoundStart()`), en el mismo instante (`gameStart`).

`#overlay-round` muestra "¡Ya!" en Fraunces itálica 400, `--bio-lime`, tamaño `calc(var(--arena-size) * 0.28)` (mínimo 72 px), y encima "Gana la serpiente más larga" en Recursive 600 18 px. El velo de la cuenta regresiva se va en 400 ms. "¡Ya!" entra con escala 0,8 a 1 con `--bio-ease-jelly` en 420 ms, se sostiene 380 ms y sale con opacidad a 0, escala 1,15 y `blur(10px)` en 380 ms. Total: 1180 ms. En la arena, la ola de inicio (5.12). `Backdrop.pulse('#C8FF3C', 0.35)`.

### 4.15 Últimos 10 segundos

Antes, a los 20 segundos, empieza el frenesí (`gameState.frenzy`, `docs/GAMEPLAY_SPEC.md`): la comida base sube un 50 % y aparece con la animación de 5.11, de a una por paso. INTEGRADOR muestra una vez el toast "Frenesí: más comida hasta el final" (info, 3 s) y llama a `Backdrop.pulse('#C8FF3C', 0.25)`; el temporizador ya está en la fase `warn`.

Disparador: `roundTimeLeft` llega a 10. Lo pinta cada responsable en lo suyo:

- **ARENA**: contador gigante (5.13) y viñeta coral creciente.
- **ESCENAS (HUD)**: temporizador en `danger` con latido por segundo; `#scene-arena[data-phase="tension"]`.
- **ESCENAS (Backdrop)**: ambiente `tension` (INTEGRADOR llama a `Backdrop.setMood('tension')` al llegar a 10 y `Backdrop.pulse('#FF4D6D', 0.15)` en cada segundo).
- **LAYOUT**: borde coral del marco de la arena con `[data-phase="tension"]`.

### 4.16 Fin de la partida

Responsables: ARENA (`Arena.onRoundEnd({ winnerId })`, con `winnerId` nulo si hay empate) e INTEGRADOR.

- **0 ms.** Llega `gameEnd` con `{ ranking: [{ id, name, color, length }], winners: [id] }`. La arena congela el último estado y enfoca al ganador (5.14). El marcador del HUD conserva el resultado: la sala ya volvió a espera en el servidor y el `updatePlayers` que sigue trae las serpientes con largo 3, pero el HUD no se actualiza con eso.
- **2000 ms.** Entra el final (4.17).

No hay panel intermedio: la partida es una sola.

### 4.17 Final

Responsable: ESCENAS (`Overlays.final(data)`, con los datos de `gameEnd`; los colores salen de `ranking`). `#finalScreen` cubre la pantalla (`position: fixed; inset: 0`), fondo `rgba(1,5,9,0.6)`. Llama a `Scenes.go('final', { color })`, que pone el fondo vivo en `celebration` con el color `body` del campeón. `#finalScreen` no es un contenedor `.scene`: se muestra encima de `#scene-arena`, que queda debajo sin animarse.

- **0 ms.** El fondo de `#finalScreen` aparece en 600 ms.
- **300 ms.** `#finalTitle` muestra el nombre del ganador (si hay empate, "Empate", sin animación por letra) en Fraunces itálica 300, `clamp(48px, 9vw, 112px)`, color `body` de su color bio con glow, `text-wrap: balance`. Cada letra es un `span.final-letter` (creado con `textContent`) que sube 30 px desde `blur(10px)` y opacidad 0, 700 ms con `--bio-ease-out`, escalonadas a 40 ms. Después, el glow del nombre respira.
- **900 ms.** `#finalMessage` ("Gana con la serpiente más larga: {n} segmentos." o, en empate, "{A} y {B} terminan con {n} segmentos.") aparece subiendo 10 px.
- **1200 ms.** Las filas de `#finalScoresList` (largo final de cada serpiente, de mayor a menor) entran escalonadas a 90 ms desde `translateY(20px)`. Las ganadoras (`.is-champion`) tienen borde izquierdo de 3 px de su color, fondo teñido con ese color al 8 % y el rango en Fraunces.
- **1700 ms.** `#finalHint` aparece con fundido: a un invitado le dice "{anfitrión} puede iniciar otra partida"; al anfitrión, solo si faltan jugadores ("Falta 1 jugador para jugar de nuevo").
- **1800 ms.** `.final-actions` sube 10 px. Para el anfitrión: `#playAgainButton` ("Jugar de nuevo", principal, respira; deshabilitado si faltan jugadores), `#backToRoomButton` ("Volver a la sala", secundario) y `#backToMenuButton` ("Salir a las salas", silencioso). Para un invitado, lo mismo sin "Jugar de nuevo". Para un espectador, solo `#backToMenuButton` como principal, con el texto "Volver a las salas". El foco va al título, no a los botones: Espacio es la tecla de disparo.

"Jugar de nuevo" emite `startGame`: la sala ya está en espera con los mismos jugadores y el mismo nivel. Cuando llega la cuenta regresiva, quien siga en el final pasa a la sala (`Scenes.go('room')`) para verla. "Volver a la sala" sale del final sin salir de la sala; ahí el anfitrión puede cambiar el nivel o esperar a más gente.

Con `reason` (sala cerrada): `#finalTitle` es "Sala cerrada" en `--bio-ink`, sin animación por letra, el fondo vivo pasa a `lobby` (no `celebration`). Con movimiento reducido: todo con fundido de 300 ms. `#finalScreen` admite `backdrop-filter: blur(6px)` solo desde 769 px y sin `pointer: coarse`.

Salida del final a la sala o a la partida: `#finalScreen` se va con el mismo fundido y la arena queda activa. Salida a las salas (`Scenes.go('lobby')`): `#finalScreen` baja a opacidad 0 con `blur(6px)` en 420 ms con `--bio-ease-in` y luego recibe `.hidden`; `#scene-arena` pasa a `hidden` en ese mismo momento (está tapada y no necesita animación); el lobby entra con la inmersión estándar y el empuje del fondo hacia abajo.

### 4.18 Modal de ranking

Responsables: LAYOUT (marcado), ESCENAS (`Overlays.open(el)` y `Overlays.close(el)`, **extensión**), INTEGRADOR (contenido).

`#leaderboardModal` cubre la pantalla con `rgba(1,5,9,0.72)`; `.modal-content` es una membrana de hasta 560 px y máximo 80vh con scroll interno. Apertura: fondo en 280 ms; tarjeta desde escala 0,96, `translateY(16px)` y opacidad 0 en 420 ms con `--bio-ease-out`; filas escalonadas a 40 ms (máximo 10). Cierre: tarjeta y fondo a opacidad 0 en 240 ms, luego `.hidden`. Cierran: `#closeLeaderboardModal` (botón de icono de 44 px con `aria-label="Cerrar"`), Escape y clic en el fondo. Foco atrapado dentro mientras está abierto; al cerrar vuelve al botón que lo abrió.

`.leaderboard-head` es una fila estática con las cabeceras de columna. Las tres primeras filas usan color de rango: primero `#E9FF70`, segundo `#BFE9F2`, tercero `#FFB38A` (rango y borde izquierdo de 3 px). `p.leaderboard-note` explica el orden.

`Overlays.open(el)` y `Overlays.close(el)` sirven para cualquier elemento con clase `.modal`: quitan o ponen `.hidden` antes o después de animar.

### 4.19 Toasts

Responsable: ESCENAS (`Toasts.show(message, type, durationMs, opts)`). Contenedor `#toasts` con `role="region"` y `aria-label="Notificaciones"`.

- Posición: desde 769 px, arriba a la derecha (`top: 80px; right: var(--bio-gutter); width: 360px`); en partida baja a `top: 20px` porque `#topbar` no está. Hasta 768 px: arriba, a todo el ancho menos el margen.
- Máximo 3 visibles; si llega un cuarto, el más viejo sale antes de tiempo. El más nuevo queda arriba.
- Mensaje idéntico (mismo texto y tipo) dentro de 2000 ms: no se crea otro, se reinicia el tiempo del existente.
- Duración por defecto: 3000 ms; `error` 4500 ms; `invitation` 9000 ms. El parámetro explícito manda.
- Pieza: `.toast` con membrana (`rgba(4,18,29,0.92)`, borde de 1 px del color del tipo al 35 %, `--bio-radius-toast`, padding 12 px 14 px), un punto de 10 px del color del tipo con glow, el texto en Recursive 16 px (14 px en móvil) y, si hay `opts.actionLabel`, un botón píldora pequeño. Abajo, una barra de 2 px que se vacía durante la duración (color del tipo al 60 %) y se pausa con hover o foco.
- Colores: `info` cian, `success` lima, `error` coral, `invitation` violeta (botón de acción con relleno violeta y texto `--bio-ink-on-invite`).
- Entrada: desde `translateY(-12px)`, escala 0,97, opacidad 0 y `blur(4px)` en 360 ms con `--bio-ease-jelly-soft`. Salida: opacidad 0, `translateX(16px)` (o `translateY(-8px)` en móvil) y `blur(4px)` en 240 ms con `--bio-ease-in`; después la altura colapsa en 200 ms con `--bio-ease-standard` para que los demás se acomoden sin salto.
- Accesibilidad: cada toast tiene `role="status"`, salvo `error`, que tiene `role="alert"`. El texto se pone con `textContent`; nunca `innerHTML`.
- Tipo `invitation`: además del toast, `Backdrop.pulse('#A98BFF', 0.4)` y el latido de `#dockToggle` (4.9).

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
    <span class="hud-goal-label">Gana la más larga</span>
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

**Jugadores de la sala** (INTEGRADOR) en `#playerList`: `li.player-item` (más `.current-player`, `.eliminated`) con `--c`, y dentro `span.player-rank`, `i.player-dot`, `span.player-name`, `span.player-host` (solo el anfitrión), `span.player-score` (el largo durante la partida; vacío en la sala) y `span.player-status` (icono de medusa con `aria-label="Con escudo"` si tiene inmunidad; vacío si no).

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

Responsable: ARENA. Todo lo de esta sección se dibuja en `canvas#game` con coordenadas lógicas de 600 × 600.

### 5.1 Orden de capas

Cada frame de `Arena.render` dibuja, en este orden:

1. Sacudida: `ctx.translate(dx, dy)` si hay una activa (5.12).
2. Fondo abisal (caché).
3. Cáusticas (2 capas de patrón).
4. Grilla de puntos (caché).
5. Nieve marina (partículas ambientales propias de la arena).
6. Contador gigante, solo en los últimos 10 segundos (va debajo de todo lo jugable para no taparlo).
7. Comida.
8. Consumibles.
9. Estelas de proyectiles y proyectiles.
10. Serpientes, en pasadas: halos de todas, cuerpos de todas, filamentos, fotóforos, cabezas. La serpiente propia va última en cada pasada.
11. Partículas de efectos (`Particles`).
12. Etiquetas de nombre y textos flotantes.
13. Membrana de bordes y destellos de portal.
14. Viñeta, y viñeta coral de tensión encima.

### 5.2 Fondo, cáusticas, grilla, nieve marina y viñeta

- **Fondo abisal** (caché a resolución del backing store, se regenera solo al cambiar el tamaño): relleno `#020A12`; degradado radial centrado en (300, 120) con radio 520, de `rgba(7,37,54,0.55)` a transparente (luz difusa desde arriba); degradado lineal en el 35 % inferior hacia `rgba(1,5,9,0.6)`.
- **Cáusticas**: al iniciar se genera una textura de 256 × 256 una sola vez. Es un diagrama de Voronoi de 12 puntos al azar con distancia envolvente (para que la textura sea repetible sin costura); el valor de cada píxel es `1 - smoothstep(0, 0.06, F2 - F1)` (dibuja las venas entre celdas), elevado a 1,5 y usado como alpha (máximo 0,9). Se guardan dos copias teñidas: cian `#4FD8FF` y coral `#FF4D6D`. Cada frame se dibujan dos capas como `createPattern` en modo `'lighter'`: capa A con escala 2,4, deriva de (6, 3) px/s y alpha 0,055; capa B con escala 3,4, deriva de (-4, 5) px/s y alpha 0,035. En tensión, la copia coral se mezcla con alpha `0,6 × nivel de tensión` y la deriva se multiplica por 1,6. En renderIdle el alpha baja al 70 %.
- **Grilla**: un punto de 0,6 px de radio en cada esquina de celda, color `#4FD8FF` con alpha 0,07. Con `s` igual a 8, un punto cada dos celdas. Se prerenderiza en un canvas fuera de pantalla al llamar a `setConfig` o al cambiar el tamaño; cada frame es un solo `drawImage`.
- **Nieve marina**: 70 partículas (45 en calidad Q1, 25 en Q0; ×0,6 con `pointer: coarse`). Cada una tiene profundidad `z` entre 0,3 y 1 que define tamaño (0,6 a 1,8 px) y alpha (0,08 a 0,35); deriva horizontal de ±3 px/s, sube a 2 a 6 px/s, vaivén de ±4 px con período de 6 a 11 segundos, y reaparece por el borde opuesto. **Durante la partida** (`Arena.render`), la nieve se dibuja al 70 % de tamaño y al 55 % de alpha y no se enciende: es fondo, y no tiene que competir con la comida ni con el escudo. **Estela de dinoflagelados**, solo en la arena de espera (`renderIdle`): si una partícula está a menos de `3·s` de la cabeza de una criatura (o del puntero), su encendido sube a 1 y toma el color `body` de esa criatura; el encendido decae en 900 ms. Con encendido, el alpha llega a 0,8 y se dibuja con sprite de glow. El costo es de 70 × 8 comparaciones de distancia por frame.
- **Viñeta**: degradado radial cacheado, transparente hasta el 55 % de la diagonal y `rgba(1,5,9,0.75)` en las esquinas. **Viñeta de tensión**: segunda caché igual con `rgba(255,77,109,0.18)`, dibujada con alpha igual al nivel de tensión (`(10 - roundTimeLeft) / 10` cuando quedan 10 segundos o menos), más un golpe de +0,25 en cada cambio de segundo que decae en 400 ms.
- **Membrana de bordes**: los bordes de la arena son portales. Cuatro franjas cacheadas de 14 px con degradado de `#1FF2D2` hacia adentro, alpha entre 0,08 y 0,12 en `--bio-dur-breath-slow`. Cuando una serpiente cruza, la franja se enciende en su color en un tramo de `6·s` centrado en el cruce durante 600 ms.

### 5.3 Sprites y cachés

No se usa `shadowBlur` en ningún dibujo por frame. Todo brillo sale de sprites prerenderizados dibujados con `globalCompositeOperation = 'lighter'`.

- **Sprite de glow**: canvas fuera de pantalla de 64 × 64 (o 128 × 128 para radios mayores a 24 px lógicos) con un degradado radial: color al 100 % en 0, al 45 % en 0,25, al 12 % en 0,55 y 0 en 1. Clave de caché: `color + '|' + tamaño`. Máximo 64 entradas (la más vieja se descarta). Se crean bajo demanda, nunca dentro de un bucle de dibujo por segmento (se piden una vez por serpiente por frame).
- **Rampa de cuerpo**: por cada color de jugador, 32 strings `rgba()` precalculadas de cabeza a cola: color `mix(body, deep, smoothstep(0.15, 1, t) * 0.85)` y alpha 1 hasta `t = 0,7`, que baja linealmente a 0,35 en `t = 1`. Se indexa con `Math.round(t * 31)`.
- **Etiquetas de nombre**: un sprite por par nombre y color, con el nombre truncado a 12 caracteres más "…", dibujado con contorno `rgba(2,10,18,0.85)` de 3 px y relleno `text`. Se regenera solo si cambia el nombre, el color o la escala de la arena.
- **Dígitos del contador gigante**: 10 dígitos × 3 colores, prerenderizados al cargar la fuente.
- **Sin allocations por frame**: buffers reutilizados (`Float32Array` para puntos de cuerpo y estelas), sin `map`, `filter`, spread ni creación de objetos dentro del bucle de render. Las cajas de `Map` por id se crean al aparecer una entidad, no por frame.

### 5.4 Serpiente

Cada serpiente se dibuja como un cuerpo continuo de criatura, a partir de `snake.getRenderSegments()` (posiciones interpoladas por `js/net/motion.js`).

**Geometría.** `P_i` es el centro del segmento `i`, con `n` segmentos. `t_i = i / max(n - 1, 1)` va de 0 (cabeza) a 1 (cola). El radio del cuerpo es `r(t) = s × (0,46 - 0,22 × t^1,4)`: 0,46·s junto a la cabeza y 0,24·s en la punta de la cola.

**Ondulación.** Cada punto, salvo la cabeza, se desplaza sobre la normal local (perpendicular a `P_{i-1} - P_{i+1}`, normalizada, usando solo vecinos del mismo tramo) una distancia `A(t) × sin(now × 0,006 - i × 0,9)`, con `A(t) = s × 0,09 × smoothstep(0, 0,25, t)`. Es poca amplitud a propósito: la posición jugable no cambia de celda. Desactivada con movimiento reducido y en calidad Q0.

**Pasadas.**

1. **Halo** (`'lighter'`): sprite de glow del color `body` en cada `P_i` (cada 2 en Q1 y Q0, con alpha × 1,5), de radio `3,2 × r(t)` y alpha `0,22 × (1 - 0,6t)`. La serpiente propia multiplica el alpha por 1,25.
2. **Cuerpo** (`'source-over'`): por cada par consecutivo del mismo tramo, una línea de `P_i` a `P_{i+1}` con `lineWidth = 2 × r(t_i)`, `lineCap = 'round'` y color de la rampa. Los extremos redondeados encadenados forman un tubo sin costuras.
3. **Filamento** (`'lighter'`): un solo trazo por tramo que recorre todos los puntos, `lineWidth = 0,22·s`, color `core` con alpha 0,75. Es la línea de luz interna.
4. **Fotóforos** (`'lighter'`): puntos de radio `0,09·s` (mínimo 1 px) con sprite `core`, alpha `0,5 + 0,5 × sin(now × 0,004 + i × 1,7)`. El patrón depende de `slot % 4`:
   - **0**: pares laterales (±0,6r sobre la normal) cada 3 segmentos.
   - **1**: un punto dorsal (sobre la línea central) cada 2 segmentos.
   - **2**: zigzag lateral, alternando lado, cada 2 segmentos.
   - **3**: grupos de 3 puntos en línea cada 5 segmentos.
   Con `s` menor a 12 se duplica la separación.
5. **Cabeza**: elipse centrada en `P_0 + dir × 0,08·s`, radio 0,56·s a lo largo de la dirección y 0,48·s a lo ancho, relleno `body`, más un sprite `core` de radio `1,0·s` y alpha 0,6. Ojos: dos círculos en `P_0 + dir × 0,18·s ± normal × 0,22·s`, esclerótica de radio `0,12·s` en `#E8FBFF` y pupila de `0,07·s` en `#01060A` desplazada `0,03·s` hacia adelante. Señuelo: curva cuadrática desde `P_0 + dir × 0,3·s` con control en `P_0 + dir × 0,7·s + normal × 0,25·s × sin(now × 0,003)` y fin en `P_0 + dir × 0,85·s + normal × 0,15·s × sin(now × 0,004 + 1)`, trazo de 1 px en `body` al 80 %; en el extremo, sprite `core` de radio `0,35·s` y un punto `#E8FBFF` de `0,08·s`.

**Dirección visual**: `normalizar(P_0 - P_1)` si los dos están en el mismo tramo y a más de `0,2·s`; si no, `snake.direction`.

**Nivel de detalle.** Con `s` menor a 12: ojos como dos puntos oscuros de 1 px y sin señuelo; los fotóforos se mantienen con la separación duplicada, porque son la segunda señal para distinguir jugadores. Con un solo segmento: solo cabeza y halo.

**Serpientes con `gameover`**: no se dibujan (igual que hoy).

### 5.5 Corte en portales

Cuando una serpiente cruza un borde, dos puntos consecutivos quedan a más de media arena de distancia. El cuerpo se corta ahí: nunca se dibuja una línea que cruce la arena.

- Al recorrer los puntos, si `|P_{i+1}.x - P_i.x| > 300` o `|P_{i+1}.y - P_i.y| > 300`, se cierra el tramo actual en `P_i` y se abre otro en `P_{i+1}`. Cada tramo se dibuja por separado en todas las pasadas (halo, cuerpo, filamento, fotóforos), y la ondulación usa solo vecinos del mismo tramo.
- `t` sigue siendo el índice global del segmento, para que el grosor y el color sean continuos de un lado al otro.
- En cada extremo de tramo que toca un borde, se dibuja un sprite de glow del color `body` con alpha 0,35 sobre el borde (x o y fijada en 0 o 600), para que la criatura parezca atravesar una membrana.
- Esto se suma a la interpolación de `js/net/motion.js`, que lleva cada segmento por el lado corto de la arena: sale por un borde y, cuando su centro lo cruza, pasa al borde opuesto. Nunca viaja de un borde al otro por adentro.

### 5.6 Jugador propio y etiquetas

- La serpiente con `id === state.myId` se dibuja última en cada pasada, con halo × 1,25.
- **Sonar**: cada 2400 ms, un anillo `#E8FBFF` de 1,5 px crece de radio `0,8·s` a `2,2·s` alrededor de su cabeza con alpha de 0,35 a 0, en 900 ms. Es la forma de encontrarse sin depender del color.
- **Etiqueta "Tú"** en `--bio-lime` sobre la cabeza propia durante los primeros 2500 ms de la partida; después, la propia no lleva etiqueta.
- **Etiquetas de otros**: el nombre sobre la cabeza, centrado en `P_0.y - (0,9·s + 8)`; si queda a menos de 16 px del borde superior, va debajo. Alpha 0,8. Tamaño lógico `max(11, 10 / escala)` para que nunca baje de 10 px CSS. Recursive 600.
- **Espectador** (`state.spectating`): no hay serpiente propia; ninguna lleva "Tú" ni sonar.
- **Corona**: la serpiente de `state.leaderId` (la más larga, decidida por el servidor: `gameState.leaderId`, `docs/GAMEPLAY_SPEC.md`) lleva una corona de luz justo encima de la cabeza, siempre derecha en la pantalla y debajo de la etiqueta: base de `1,4·s` de ancho a `0,75·s` sobre el centro de la cabeza, tres puntas (las de los lados a `0,42·s`, la del medio a `0,62·s`), relleno `rgba(255, 224, 138, 0.28)` y trazo `#FFE08A` de 1,4 px, una perla de radio `0,22·s` en cada punta y un glow dorado de radio `1,3·s`. Sube y baja ±0,6 px. Se dibuja con la partida en curso y durante el congelado final; en el modo atracción, no.

### 5.7 Inmunidad

La inmunidad se ve como una medusa que envuelve la cabeza. Está activa si `snake.activeConsumable` existe y su `type` es `'immunity'` (el servidor lo anula al vencer, `snakeClass.js:247-257`). `endTime` se usa solo para el aviso de vencimiento, porque puede haber desfase de reloj entre servidor y cliente.

- **Campana**: media elipse orientada hacia la dirección de avance sobre la cabeza, radio `0,95·s`, relleno `#9FF4FF` con alpha 0,18, borde de 1,5 px `#E8FBFF` con alpha 0,7. Late a 1,6 Hz: escala horizontal `1 + 0,08 × sin` y vertical `1 - 0,08 × sin`.
- **Membrana del cuerpo**: un trazo por tramo de ancho `2r + 0,5·s`, `#9FF4FF` con alpha 0,10 en `'lighter'`, que late ±0,05 con la campana.
- **Aviso de vencimiento**: cuando faltan menos de 1500 ms según `endTime`, la campana parpadea a 4 Hz entre alpha 1 y 0,25.
- **Al activarse** (`onConsumablePicked`): la campana se infla de escala 0 a 1 en 360 ms con `easeOutBack`. **Al bloquear** (`onBlock`): la campana crece a 1,35 y se desvanece en 280 ms.

**Ancla.** La serpiente anclada (`anchoredUntil` mayor que la hora del servidor del instante dibujado, `state.serverT`) se cierra: el cuerpo deja de ondular; debajo del cuerpo, una coraza `#E8FBFF` al 85 % de ancho `2 × radio de la cabeza + 2,4 px` asoma como contorno; encima, una placa perla de 1 px al 50 % cruza el cuerpo cada dos segmentos (80 % del radio a cada lado); los fotóforos bajan al 35 %. Sobre la cabeza, un aro de radio `1,15·s` y 2 px: la pista al 20 % y el arco al 90 % en `'lighter'`, que arranca arriba y se vacía en sentido horario con el tiempo que le queda (`anchorLastsMs`, de la configuración de la sala).

### 5.8 Comida

La comida es plancton: un orbe que late, de tamaño y brillo según su valor (1 a 5). El valor siempre se puede leer por la cantidad de satélites que orbitan; el dígito se agrega cuando hay espacio. Los tamaños están en px de la arena (600) y no dependen de la celda: con celdas de 12 px, un orbe proporcional quedaba del tamaño de un copo de nieve marina. Los colores van de verde menta a ámbar y evitan el celeste, que es de la nieve y del escudo.

| Valor | Radio del orbe | Color | Satélites |
|---|---|---|---|
| 1 | 4,0 px | `#7CFFB2` | 1 |
| 2 | 4,4 px | `#B8FF5A` | 2 |
| 3 | 4,8 px | `#E8F24A` | 3 |
| 4 | 5,2 px | `#FFD447` | 4 |
| 5 | 5,6 px | `#FFA347` | 5, más un anillo exterior |

- Orbe: sprite de glow del color con radio `1,9 × r × (1 + 0,1 × valor)` en `'lighter'`, y encima un disco de radio `r` con degradado radial de `#E8FBFF` en el centro al color en el borde, rodeado por un contorno oscuro (`rgba(2, 19, 28, 0.85)`, 1,3 px). El contorno es lo que lo separa del glow y lo hace leer como objeto: la nieve marina nunca lo tiene.
- Respiración: escala `1 ± 0,06` a 0,8 Hz y vaivén vertical de `±0,06·s`, con fase propia derivada de la posición: `((x × 73856093) ^ (y × 19349663)) & 1023`, normalizado a 0 a 2π. Sin números al azar por frame.
- Satélites: puntos de radio `0,06·s` (mínimo 1 px) que orbitan a `1,6r + 1,5` a 1,6 rad/s, espaciados de forma pareja.
- Dígito: si `1,15·r × escala ≥ 7` px CSS, el valor en Recursive MONO 700 de tamaño `1,15·r`, color `#02131C` sobre el centro del orbe.
- **Restos** (comida con `remains`, ver `docs/MOTION_SPEC.md`): se dibujan igual que la comida de su valor y aparecen con el mismo crecimiento de 450 ms. En sus últimos 2 s se desvanecen: `fade = (expiresAt - rt) / 2000`, con `rt` la hora del servidor del instante dibujado, que `SnakeGame.js` calcula al aplicar cada muestra de la línea de tiempo.

### 5.9 Consumibles

Hay tres consumibles: escudo, boca grande y abanico (`docs/GAMEPLAY_SPEC.md`). Cada uno tiene su silueta y su color, de tamaño fijo en px de la arena, y los tres comparten el anillo de sonar en su color: es la seña de que algo se puede tomar. Los colores (`CONS_LOOK` en `arena.js`) son violeta `#B9A6FF` para el escudo, rosa `#FF8FD0` para la boca grande y coral `#FF7A59` para el abanico. Ninguno es redondo como la comida.

**Escudo.** Una medusa que flota en su celda, de tamaño fijo en px de la arena y violeta, para que no se confunda con la comida ni con la nieve. Campana de 15 px de ancho y 9 px de alto con degradado de `#D9CCFF` a `#9C82FF` (alpha 0,75) y borde `#F3EEFF` al 90 %; tres tentáculos `#D6CCFF` de 1,2 px como curvas cuadráticas de 8 px que se mecen con `sin(now × 0,004 + k)`; núcleo perla de radio 4 px. Glow `#B9A6FF` de radio 20 px con alpha 0,5 que late a 0,7 Hz, y un glow `#9FF4FF` de radio 12 px con alpha 0,35. La campana late a 1,4 Hz y la medusa sube y baja ±1,2 px.

- **Sonar**: cada 2000 ms (con fase propia), un anillo de 1,5 px en el color del consumible se abre de radio 9 a 26 px con `easeOutCubic` mientras su alpha baja de 0,6 a 0 (al cuadrado). Es lo que lo hace visible de lejos. Se distingue del sonar de la cabeza propia por el color y porque el consumible no se mueve.
- Puesta, la inmunidad sigue siendo la campana celeste de 5.7 sobre la cabeza.

**Boca grande.** Una anémona rosa: ocho tentáculos `#FF8FD0` de 1,4 px con punta redondeada, curvas cuadráticas que van del radio 3 al 8,5 px y se mecen ±0,14 rad (±0,22 en la punta, así no se cruzan), con una perla `#FFD6EC` de radio 1,1 px en cada punta. En el centro, una boca de radio 2,6 px (`rgba(58, 8, 40, 0.9)` con borde `#FFD6EC` de 1,2 px) que se abre y se cierra ±12 % con el latido de 1,4 Hz. Glow rosa de radio 18 px con alpha 0,5. Mientras está activa, un anillo punteado `#FF8FD0` (3 px de trazo y 4 de hueco, que gira despacio) marca el alcance alrededor de la cabeza: radio `bigMouthReach × s`, alpha 0,34 ± 0,08, en `'lighter'`.

**Abanico.** Una estrella de mar coral de cinco brazos (radio exterior 8,5 px, interior 3,6 px) que gira a 0,4 rad/s: relleno `#FF7A59` al 90 %, borde `#FFD2C4` de 1,2 px con uniones redondeadas, dos poros `#FFE3D9` de radio 0,8 px por brazo y un núcleo perla de radio 3 px. Glow coral de radio 18 px con alpha 0,5.

### 5.10 Proyectiles

Pulso de luz con estela. Posición: `x, y` que `Motion.projectileAt` (`js/net/motion.js`) interpola para el instante dibujado, más `s/2`.

- **Núcleo**: cápsula orientada en `direction`, largo `0,9·s` y ancho `0,36·s`, color `core` del tirador (resuelto con `Arena.bioColor(projectile.color)`).
- **Halo**: sprite `body` de radio `1,6·s` con alpha 0,8 y parpadeo `1 + 0,15 × sin(now × 0,05)`.
- **Estela**: por cada id, un buffer circular de las últimas 10 posiciones de render (`Float32Array(20)`), muestreadas cada frame. Se dibuja como trazos encadenados que se afinan de `0,36·s` a 0 y bajan de alpha 0,7 a 0, en `'lighter'` con el color `body`. Cuando el id deja de venir en el estado, la estela se desvanece en 300 ms y el buffer se libera. Q0: 5 posiciones.

### 5.11 Apariciones

El servidor no avisa cuando aparece comida o un consumible, así que la arena lo detecta. Cuando `state.foods` cambia de referencia (el integrador reemplaza el array en cada frame del servidor), se compara contra el conjunto anterior con claves numéricas `x × 1000 + y` (sin strings). Lo nuevo entra con escala 0 a 1 en 450 ms con `easeOutBack` y un anillo que crece de `0,3·s` a `1,4·s` en 360 ms. Los consumibles se comparan por `id`. La primera vez que llega un estado (inicio de la partida o entrada como espectador) no hay animación de aparición.

### 5.12 Catálogo de efectos por evento

INTEGRADOR llama al hook correspondiente por cada elemento de los arrays de `gameLogicFrame` (sección 9), **antes** de aplicar las posiciones nuevas a las serpientes. La arena guarda una referencia al último `state` recibido para ubicar serpientes por id.

Valores de partículas: `count` es la cantidad; `speed` en px/s; `life` en ms; `size` en px de radio para `s` igual a 20 (Arena lo multiplica por `s / 20` antes de llamar a `burst`); `gravity` en px/s² (negativa = sube, como flotación); `drag` es la fracción de velocidad que se conserva cada 1/60 s. "Si soy yo" significa `e.targetId`, `e.playerId` o `e.attackerId === state.myId`, según el caso. Las cantidades bajan al 50 % con movimiento reducido.

- **Comer** (`onFoodEaten`, `foodEvents`). Centro de la celda. Ráfaga: `count` = 6 + 4 × valor, color de la comida (tabla 5.8), `speed` [30, 70 + 20 × valor], `life` [380, 700], `size` [1,2, 2,4], forma `dot`, `gravity` -10, `drag` 0,9. Anillo del mismo color de `0,4·s` a `1,8·s` en 320 ms con alpha 0,7. **Peristalsis**: un bulto luminoso (radio + 25 %, color `core`) recorre el cuerpo del que comió de la cabeza a la cola a 22 segmentos por segundo (máximo 3 a la vez por serpiente). Si soy yo: texto flotante "+{valor}" en el color de la comida, Recursive MONO 700, que sube 18 px y se desvanece en 700 ms. **Con la boca grande**, si la comida estaba a más de `1,2·s` de la cabeza (y a menos de `4·s`, para no cruzar un portal), una estela la lleva hasta la boca en 170 ms: un trazo del color de la comida de 2 px a 1 px y una perla de radio `0,9·s` que acelera (`t²`) hacia la cabeza, que sigue moviéndose.
- **Impacto en el cuerpo** (`onHit`, `headshot` falso). En la celda del impacto. Fragmentos: `count` = min(48, 10 + 5 × `segmentsLost`), repartidos 60 % forma `spark` y 40 % `dot`, color `body` de la víctima, `speed` [60, 200], `life` [500, 1000], `size` [1,5, 3,2], `gravity` -20, `drag` 0,9. Chispa del atacante: 6 `spark` del color `body` del atacante, `speed` [80, 160], `life` [250, 400]. Destello: sprite `#E8FBFF` de radio `2,5·s` con alpha de 0,5 a 0 en 160 ms. **Cola desprendida**: los últimos `segmentsLost` puntos de render de la víctima (copiados en el hook, antes de que lleguen las posiciones nuevas) siguen dibujándose como cuerpo atenuado que deriva al azar (±10 px/s), se hunde a 8 px/s y se apaga en 900 ms. Texto flotante "-{segmentsLost}" (con signo menos tipográfico U+2212) en el color `text` de la víctima, siempre. Sacudida: si soy la víctima, 7 px durante 280 ms y `Backdrop.pulse('#FF4D6D', 0.25)`; si soy el atacante, 2,5 px durante 120 ms.
- **Impacto en la cabeza** (`onHit`, `headshot` verdadero). Todo lo anterior con 12 fragmentos más, destello con alpha 0,7 y dos anillos (el segundo 90 ms después). **Nube de tinta**: 10 partículas de forma `ink`, color `deep` de la víctima, `size` [6, 14], `speed` [10, 40], `life` [1200, 1800], `drag` 0,95, `gravity` 0, alpha máximo 0,45, en `'source-over'`. Sobre el número flotante, la palabra "cabeza" en 11 px lógicos (con el mínimo de 10 px CSS). Sacudida: víctima 10 px durante 360 ms; atacante 4 px durante 160 ms.
- **Impacto contra una serpiente anclada** (`onHit` con `anchored`). El disparo rebota en la coraza: 14 `spark` `#E8FBFF` rápidos y cortos (`speed` [120, 260], `life` [200, 380]) y 6 del color `body` del atacante, un anillo seco `#E8FBFF` de `0,3·s` a `1,4·s` en 200 ms con alpha 0,9 y texto flotante "−1" en `#E8FBFF` ("Sin daño" si medía 1). Sin cola desprendida, sin tinta y sin destello. Sacudida: víctima 3 px durante 120 ms; atacante 1,5 px durante 80 ms.
- **Bloqueo** (`onBlock`). En la celda del bloqueo. Burbujas: 14 de forma `bubble`, `#9FF4FF`, `speed` [40, 120], `life` [500, 900], `size` [1,5, 3,5], `gravity` -40, `drag` 0,9. Dos anillos `#9FF4FF` (el segundo 80 ms después). La campana del jugador estalla (5.7). Si soy el jugador o el atacante: texto flotante "Bloqueado" en `#9FF4FF`. Si soy el jugador: sacudida de 3 px durante 140 ms y `Backdrop.pulse('#9FF4FF', 0.15)`.
- **Portal** (`onPortal`, con `fromX`, `fromY`, `toX`, `toY`). En los dos puntos de cruce sobre el borde: onda en media elipse aplastada contra el borde (radio `1,6·s` a lo largo del borde y `0,5·s` hacia adentro) del color `body`, alpha 0,6, 420 ms; 6 partículas `dot` por lado que se alejan del borde hacia adentro; la membrana del borde se enciende (5.2). Sin sacudida.
- **Disparo** (`onProjectileFired`). En el punto de salida: 6 `spark` en cono (dirección del disparo, apertura 0,9 rad), color `body` del tirador, `speed` [80, 180], `life` [180, 320]. **Costo visible**: en la punta de la cola del tirador (último punto de render), una gota de luz de radio `0,35·s` se desprende, se hunde y se apaga en 500 ms, con 4 partículas chicas. La cabeza del tirador retrocede `0,15·s` durante 90 ms (solo visual). Si soy el tirador: sacudida de 1,5 px durante 80 ms. **Abanico**: los dos disparos laterales llegan con `spread: true` y solo hacen el cono de chispas de salida; la gota de la cola, el retroceso y la sacudida salen una vez, con el disparo central, porque la ráfaga cuesta un solo segmento.
- **Proyectil expirado** (`onProjectileExpired`, **extensión**, `expiredProjectiles`). En la última celda dentro de la arena: 7 `dot` del color del proyectil (la arena recuerda el color por id; si no lo encuentra, `#4FD8FF`), `speed` [20, 60], `life` [300, 500]; anillo de `0,3·s` a `1·s` en 240 ms; la membrana del borde parpadea en ese punto.
- **Consumible recogido** (`onConsumablePicked`, con `x`, `y`, `consumableType`). Anillo de `0,5·s` a `2,4·s` en 420 ms; 18 `dot` mitad en el color claro y mitad en el del sonar, `speed` [40, 120], `life` [500, 900], `gravity` -30. Colores por tipo: escudo `#9FF4FF` (anillo), `#C9F8FF` y `#B9A6FF`; boca grande `#FF8FD0`, `#FFD6EC` y `#FF8FD0`; abanico `#FF7A59`, `#FFE3D9` y `#FF7A59`. Solo el escudo infla la campana del jugador (5.7). Si soy yo: `Backdrop.pulse` con el color del anillo y alpha 0,2 (el toast lo pone INTEGRADOR, con un texto por tipo).
- **Inicio de la partida** (`onRoundStart`; el nombre viene de cuando había rondas). Ola: un anillo desde el centro que crece de radio 0 a 450 en 800 ms con `easeOutExpo`, `lineWidth` de 40 a 2, turquesa con alpha 0,25 en `'lighter'`. Los halos de todas las serpientes se multiplican por 1,6 y vuelven a 1 en 600 ms. Serpiente propia: tres anillos de sonar seguidos (0, 200 y 400 ms), de `0,5·s` a `4·s` en 700 ms cada uno, y la etiqueta "Tú" (5.6). Se descartan las colas desprendidas y estelas de la partida anterior.
- **Fin de la partida** (`onRoundEnd({ winnerId })`). Ver 5.14.

**Sacudida** (`Arena.shake(intensity, ms)`): desplazamiento `dx = I × k × sin(now × 0,071)`, `dy = I × k × cos(now × 0,053)` con `k = (1 - t)²` y `t` el progreso. Si hay varias activas, manda la de mayor intensidad restante. Solo mueve el contenido de la arena (no el HUD ni el marco). Con movimiento reducido no hace nada.

**Límite de destellos**: como máximo 3 destellos por segundo en total (los que excedan se omiten), siempre locales (nunca la arena entera en blanco) y con alpha máximo 0,7.

### 5.13 Contador de los últimos 10 segundos

Reemplaza a `drawCountdown`. Con `state.playing` verdadero y `roundTimeLeft` entre 1 y 10, se dibuja el número entero centrado en (300, 312), en Fraunces itálica 300 desde los sprites de dígitos, en `'lighter'`, debajo de lo jugable (capa 6).

| Segundos | Tamaño lógico | Color | Alpha base |
|---|---|---|---|
| 10 a 6 | 300 px | `#1FF2D2` | 0,10 |
| 5 y 4 | 300 px | `#FFB547` | 0,14 |
| 3 a 1 | 340 px | `#FF4D6D` | 0,20 |

En cada cambio de número: escala de 1,18 a 1 en 450 ms con `easeOutExpo` y alpha que arranca en el doble de la base y baja a la base. Con movimiento reducido, sin escala.

### 5.14 Fin de la partida en la arena

Al recibir `onRoundEnd({ winnerId })`, la arena entra en congelamiento durante 2400 ms (las llamadas a `render` siguen llegando con el último estado congelado):

- La nieve marina y las cáusticas bajan al 25 % de su velocidad en 400 ms (cámara lenta).
- Las serpientes que no ganaron bajan a alpha 0,35 y pierden el filamento, en 600 ms con `easeInOutSine`.
- Sobre el ganador baja una columna de luz (sprite de degradado vertical de ancho `6·s`, de alpha 0 a 0,35 en 500 ms) y brota una fuente de plancton: 80 partículas repartidas en 1200 ms desde su cabeza, en sus colores `body` y `core`, ángulo hacia arriba con apertura de 1,2 rad, `speed` [40, 140], `gravity` -20, `life` [900, 1600]. Su etiqueta de nombre crece a 1,4 veces.
- Si el ganador soy yo: `Backdrop.pulse('#C8FF3C', 0.5)`.
- La viñeta de tensión y el contador gigante se desvanecen en 800 ms.
- Si `winnerId` es nulo (empate), solo la cámara lenta.

A los 2000 ms entra la pantalla final encima (4.17). Después del congelamiento, el integrador pasa a `Arena.renderIdle` debajo del final.

### 5.15 Modo atracción (renderIdle)

`Arena.renderIdle(nowMs, { snakesPreview, caption })` mantiene la arena viva cuando no hay partida en curso: en la sala de espera y debajo de la pantalla final. Dibuja las capas de fondo (cáusticas al 70 %), la nieve marina, y una criatura por jugador de `snakesPreview` (**extensión** de forma: `[{ id, name, color, isMe }]`; `caption` es un texto opcional, también extensión).

- Cada criatura nada libre: rumbo que cambia suave (ruido de valor con período de 3 a 5 segundos), velocidad de 38 px/s, giro de evasión cuando se acerca a menos de 40 px de un borde (no cruza portales en este modo). El cuerpo se arma con un historial de posiciones muestreado cada `0,8 × s_idle` de recorrido, 10 puntos, con `s_idle = clamp(segmentSize, 14, 22)`. Se dibuja con el mismo renderizador de 5.4, incluidos fotóforos, señuelo y etiqueta con el nombre.
- La propia (`isMe`) lleva etiqueta "Tú" en lima permanente y sonar.
- **Eclosión** (id nuevo en `snakesPreview`): en un punto al azar a más de 80 px de los bordes, un anillo `core` que crece y 20 partículas; la criatura crece de 2 a 10 puntos en 1200 ms.
- **Disolución** (id que desaparece): el cuerpo se convierte en partículas (3 por punto) que suben y se apagan en 900 ms.
- Si `snakesPreview` llega vacío o ausente, nadan 3 criaturas anónimas atenuadas (alpha 0,5, sin etiqueta).
- `caption`: si viene, se dibuja centrado a 28 px del borde inferior en Recursive 16 px `--bio-ink-2` con contorno oscuro.
- Las posiciones de las criaturas persisten entre llamadas (claves por id), así una actualización de la lista no reinicia a nadie.

### 5.16 API de Particles

`Particles.createSystem({ max })` devuelve un sistema con un pool preasignado de `max` partículas en arrays tipados (`Float32Array` para x, y, vx, vy, edad, vida, tamaño, tamaño final, alpha, gravedad, drag; `Uint8Array` para forma, blend e índice de color). Si el pool está lleno, la partícula nueva reemplaza a la más vieja (tope duro). Tope por defecto de la arena: 600 en Q2, 400 en Q1, 200 en Q0.

- `burst(x, y, opts)`: `count` (12), `color` (`'#1FF2D2'`), `speed` ([40, 120]), `life` ([400, 800]), `size` ([1, 2,5]), `endSize` (opcional, para anillos), `spread` (2π), `angle` (0), `gravity` (-12), `drag` (0,92), `glow` (verdadero), `shape` (`'dot'`), `alpha` (1). Los rangos `[min, max]` se muestrean uniforme; un número fijo vale igual.
- `emit(opts)`: una partícula con `x`, `y`, `vx`, `vy` explícitos y el resto de las opciones de `burst`.
- `update(dtMs)`: integra con `dt` acotado a 50 ms. Vida: alpha sube en el primer 10 % y baja con `1 - easeInQuart` en el resto.
- `draw(ctx)`: agrupa por forma para cambiar `globalCompositeOperation` pocas veces. Formas: `dot` (sprite de glow), `spark` (línea a lo largo de la velocidad, largo `velocidad × 0,03`), `ring` (círculo trazado que crece de `size` a `endSize`), `bubble` (círculo trazado con un brillo de 1 px arriba a la izquierda), `ink` (sprite oscuro en `'source-over'`).
- `clear()`, `count()`.
- Los colores se registran en un mapa string a índice y su sprite se crea una vez. Sin allocations en `update` ni `draw`.

### 5.17 API de Arena

Firmas del contrato, más las extensiones marcadas:

- `Arena.init(canvasEl)`: toma `#game`, crea los cachés y observa el tamaño de su contenedor con `ResizeObserver` (con espera de 120 ms). Backing store = tamaño CSS × `min(devicePixelRatio, 2)` (1,5 en Q0), con `ctx.setTransform(escala, 0, 0, escala, 0, 0)` para trabajar siempre en 600 × 600 lógicos.
- `Arena.setConfig({ segmentSize, width: 600, height: 600 })`: regenera grilla y cachés que dependen de `s`.
- `Arena.render(state, nowMs)` y `Arena.renderIdle(nowMs, opts)`: secciones 5.1 a 5.15. Calculan su propio `dt` a partir de `nowMs`.
- Hooks: `onFoodEaten(e)`, `onHit(e)`, `onBlock(e)`, `onPortal(e)`, `onProjectileFired(e)`, `onConsumablePicked(e)`, `onRoundStart()`, `onRoundEnd({ winnerId })`, `shake(intensity, ms)`, y **extensión** `onProjectileExpired(e)`.
- **Extensión** `Arena.bioColor(hex)`: sección 2.3.
- **Calidad adaptativa** (interna): arranca en Q2 (Q1 con `pointer: coarse`). Con un promedio móvil de 90 frames mayor a 19 ms, baja un nivel y espera 5 segundos antes de volver a medir. No sube sola. Q1: sin capa B de cáusticas, halo cada 2 segmentos, nieve marina 45, tope de partículas 400. Q0: sin cáusticas ni ondulación, nieve marina 25, tope 200, estelas de 5 puntos, `devicePixelRatio` máximo 1,5.

## 6. HUD

Responsable: ESCENAS (`HUD.update`, `HUD.show`, `HUD.hide`); LAYOUT estiliza el marcado de 4.21. `#hud` reemplaza a `#infoCanvas`.

### 6.1 Barra superior (`.hud-bar`)

Membrana de 64 px de alto (48 en móvil) del ancho de la arena, en tres zonas.

- **Meta** (izquierda): "Gana la más larga" en Recursive 600 14 px `--bio-ink-2` (12 px en móvil), truncado con elipsis si no entra. Reemplaza a la ronda y sus pips: la partida es una sola.
- **Temporizador** (centro): SVG de 64 × 64 a 56 px CSS. Pista de radio 26 y trazo de 4 px en `rgba(255,255,255,0.08)`; progreso de radio 26 y 4 px con extremos redondeados, `stroke-dasharray` de 163,4 (2π × 26) y `stroke-dashoffset = 163,4 × (1 - timeLeft / roundTime)`, con transición lineal de 1000 ms (así el anillo baja continuo entre los ticks de segundo). Un tercer círculo de radio 29 y trazo de 1 px con `stroke-dasharray: 2 6` gira una vuelta cada 40 segundos: son los cilios. La cifra va en el centro en Recursive MONO 700 24 px, como minutos y segundos ("1:42") desde un minuto y solo segundos por debajo; su `aria-label` lo dice en palabras ("1 minuto y 42 segundos").
- **Estado** (derecha): un indicador por efecto propio activo, el indicador del ancla o el badge de espectador.

Fases del temporizador (`data-phase`, también reflejado en `#scene-arena[data-phase]`). Con `playing` falso (fin de la partida, o espectador antes de que empiece) la fase vuelve a `calm`.

| Fase | Segundos restantes | Color | Comportamiento |
|---|---|---|---|
| `calm` | más de 20 | `#1FF2D2` | Quieto |
| `warn` | 20 a 11 | `#FFB547` | Cambio de color en 300 ms |
| `tension` | 10 a 0 | `#FF4D6D` | Latido por segundo (escala 1 a 1,12 a 1 en 220 ms con `--bio-ease-jelly`), glow `drop-shadow` en el SVG; desde 3, la cifra queda en `scale(1.16)` |

**Efectos propios**: un `.hud-shield` por tipo (`data-effect`), en orden fijo: escudo, boca grande y abanico. Cada uno aparece con el revelado de 4.20 cuando el efecto está en `effects` del jugador propio: icono de 18 px (medusa, anémona o estrella), la palabra ("Escudo", "Boca grande", "Abanico"), el tiempo restante con coma decimal ("3,2 s", calculado con su vencimiento) y una barra de 40 × 3 px que se vacía. El color sale de `--fx`: `#9FF4FF` para el escudo, `#FF8FD0` para la boca grande y `#FF7A59` para el abanico; borde y fondo son ese color al 40 % y al 7 %. El icono late a 1,6 Hz. Al vencer, sale con opacidad y escala 0,9 en 240 ms. Con dos o más a la vez, cada uno queda en icono y tiempo: la palabra pasa a ser solo para el lector de pantalla y la barra se oculta, así los tres entran en la columna sin pisar el temporizador.

**Ancla** (`.hud-anchor`, solo con teclado y mouse: en táctil la muestra su botón): píldora con el icono del ancla. Lista: borde perla al 35 % y la tecla "E" en un recuadro. Anclada: fondo perla al 16 % con glow perla, sin la tecla. Recargando: en `--bio-ink-3`, con un relleno que avanza de izquierda a derecha (`--p`, de 0 a 1) hasta estar lista. Su `aria-label` dice el estado.

**Espectador**: `.hud-spectator`, píldora con borde violeta, icono de ojo y "Espectador".

### 6.2 Marcador (`.hud-board`)

Lista ordenada de los jugadores, en filas de 36 px. Cada jugador llega con el color del servidor; HUD lo traduce con `Arena.bioColor` y usa `body` para el punto y la barra, y `text` para el nombre.

- Cada fila: rango (MONO 600 14 px `--bio-ink-3`, 20 px de ancho), punto de 10 px en el color `body` con glow, nombre en Recursive 500 16 px color `text` (truncado con elipsis a 12 caracteres), puntaje en MONO 700 16 px alineado a la derecha, y debajo del nombre una barra de 2 px cuyo ancho es la proporción respecto del líder (`--w`), en el color `body` al 70 %, con transición de ancho de 300 ms.
- Fila propia: borde izquierdo de 3 px lima, etiqueta "Tú" en lima 12 px después del nombre.
- Con inmunidad: icono de medusa de 14 px en `#9FF4FF` después del nombre.
- `gameover`: opacidad 0,4.
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
- Tope duro de partículas: arena 600, fondo vivo 260.
- `devicePixelRatio` máximo 2 en la arena; el fondo vivo trabaja a media resolución (0,35 en partida).
- El fondo vivo baja a 30 fps en partida y se detiene con `document.hidden`. La arena no se dibuja cuando su escena no está visible (lobby, login).
- Calidad adaptativa de la arena (5.17).
- Prohibido `backdrop-filter` en paneles persistentes (el fondo de abajo cambia cada frame y obligaría a recalcular el desenfoque). Permitido solo en `.modal` y `#finalScreen`, con un máximo de 8 px, desde 769 px y sin `pointer: coarse`.
- `filter: blur()` solo durante transiciones, sobre contenedores de escena o piezas de overlay, y se retira al terminar.
- INTEGRADOR no reconstruye `#playerList` en cada frame (hoy lo hace en `SnakeGame.js:1574`): en partida el marcador vivo es el HUD.
- Animaciones DOM solo sobre `transform`, `opacity` y `filter`; nunca sobre `width`, `height`, `top` o `left`, salvo la barra de largo del marcador y el colapso de altura de los toasts.

### 7.2 Accesibilidad

- Contraste: los pares de la sección 2.1. Nombres sobre la arena con contorno oscuro y tamaño mínimo de 10 px CSS. Nada interactivo por debajo de 14 px.
- El color nunca es la única señal: patrón de fotóforos por jugador (5.4), etiqueta "Tú" y sonar para el propio, nombres en la arena, icono además del color para el escudo.
- Movimiento reducido: tabla 3.6. Fotosensibilidad: máximo 3 destellos por segundo, siempre locales, alpha máximo 0,7 (0,25 con movimiento reducido).
- `prefers-contrast: more`: paneles con alpha 0,96, `--bio-ink-3` pasa a valer `--bio-ink-2`, sin cáusticas en la arena.
- Teclado: todo se puede operar con Tab, Enter y Escape. Foco visible (3.4). El modal atrapa el foco. Las escenas inactivas tienen `inert`.
- Lectores de pantalla: `<html lang="es">`; toasts con `role="status"` o `role="alert"`; `#overlay-round` con `aria-live="polite"` (anuncia "Gana la serpiente más larga, ¡Ya!"); el temporizador del HUD con `aria-label` y sin `aria-live` (sería ruido cada segundo); `#gameOverScreen` y `#finalScreen` con `role="dialog"` y `aria-labelledby`; el canvas con `aria-label="Arena de juego"`.
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
| `.intro-prompt` (teclado) | Pulsa cualquier tecla para sumergirte |
| `.intro-prompt` (`pointer: coarse`) | Toca la pantalla para sumergirte |
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
| `.controls-hint` `player` | Flechas o WASD para moverte. Espacio para disparar: cada disparo cuesta un segmento. |
| `.controls-hint` `spectator` | Estás viendo la partida en vivo. |
| `.controls-hint` `touch` | Para jugar necesitas un teclado. Desde el móvil puedes mirar partidas en curso. |
| `#spectatorBanner` | Modo espectador |

### 8.4 Partida, overlays y ranking

| Elemento | Texto |
|---|---|
| HUD meta | Gana la más larga |
| HUD temporizador | {m}:{ss} desde un minuto, {s} debajo (`aria-label`: "{m} minutos y {s} segundos") |
| HUD caption | Largo actual |
| HUD fila propia, etiqueta en arena | Tú |
| HUD escudo | Escudo {x,y} s |
| HUD espectador | Espectador |
| Cuenta regresiva | Gana la serpiente más larga, luego 3, 2, 1 |
| Inicio de la partida | Gana la serpiente más larga, ¡Ya! |
| `#finalTitle` | {nombre del ganador} (en empate, "Empate"; o "Sala cerrada") |
| `#finalMessage` | Gana con la serpiente más larga: {n} segmentos. / En empate: {A} y {B} terminan con {n} segmentos. (singular: 1 segmento) |
| Título de la clasificación | Clasificación final |
| `.final-total` | {n} segmentos (1 segmento) |
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
| Textos flotantes en la arena | +{n} / -{n} (con U+2212) / cabeza / Bloqueado |

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
| `consumableEvents` (soy yo) | Escudo activo: bloquea un disparo | success, 2500 ms |
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
- **`hitEvents`**: en `moveProjectiles` (`index.js:651-663`), cuando un proyectil impacta un segmento sin inmunidad: `{ targetId: player.id, attackerId: projectile.playerId, x: segment.x, y: segment.y, segmentsLost, headshot: i === 0, color: player.color, attackerColor: projectile.color }`. `segmentsLost` es la cantidad realmente quitada: en la cabeza, las veces que se ejecutó `pop()`; en el cuerpo, `largoAntes - i`.
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

**`gameLogicFrame`**, en este orden: despachar `foodEvents`, `hitEvents`, `blockEvents`, `portals`, `projectileEvents`, `expiredProjectiles` y `consumableEvents` a sus hooks de Arena; aplicar jugadores, proyectiles, comida y consumibles (como hoy); llamar a `HUD.update`; si `roundTimeLeft` llegó a 10, `Backdrop.setMood('tension')`, y desde ahí `Backdrop.pulse('#FF4D6D', 0.15)` en cada segundo nuevo.

**Otros eventos**:

- `countdown`: `Overlays.countdown(count, state.round)`.
- `gameStart`: `Scenes.go('game')`, `Overlays.roundStart(round, 3)`, `Arena.setConfig(...)`, `Arena.onRoundStart()`, `HUD.show()`, `Backdrop.setMood('game')`.
- `roundEnd`: `Arena.onRoundEnd({ winnerId: data.winner ? data.winner.id : null })`, `Overlays.roundEnd(data, { colorsById })`, `HUD.update` con totales y `playing: false`, `Backdrop.setMood('game')` (sale de `tension`).
- `configUpdated`: `Arena.setConfig({ segmentSize, width: 600, height: 600 })`, igual que en `gameStart` y `spectatingStarted`.
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
