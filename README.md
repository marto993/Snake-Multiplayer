# 馃悕 Snake Multiplayer

[![Made with Node.js](https://img.shields.io/badge/Made%20with-Node.js-339933?style=flat-square&logo=node.js)](https://nodejs.org/)
[![Socket.IO](https://img.shields.io/badge/Real--time-Socket.IO-010101?style=flat-square&logo=socket.io)](https://socket.io/)
[![SQLite](https://img.shields.io/badge/Database-SQLite-003B57?style=flat-square&logo=sqlite)](https://sqlite.org/)
[![Deployed on Fly.io](https://img.shields.io/badge/Deployed-Fly.io-8B5CF6?style=flat-square)](https://fly.io/)

Juego Snake multijugador en tiempo real con salas privadas, sistema de combate y estad铆sticas persistentes.

## Caracter铆sticas

### Multijugador en Tiempo Real
- Hasta 16 jugadores por sala
- Salas con c贸digos 煤nicos de 6 caracteres
- Sistema de invitaciones entre jugadores
- Sincronizaci贸n client-server con interpolaci贸n suave

### Mec谩nicas de Juego
- **Partidas por rondas**: 3 rondas de 60 segundos cada una
- **Sistema de combate**: Proyectiles que reducen el tama帽o de otros jugadores
- **Consumibles**: Power-ups como inmunidad temporal
- **Portales**: Teletransporte en los bordes del mapa
- **Configuraci贸n personalizable**: Velocidad, tama帽o de segmentos, consumibles

### Persistencia de Datos
- Perfiles de usuario con estad铆sticas completas
- Rankings globales por victorias y winrate
- Reconexi贸n autom谩tica con sesiones persistentes
- Base de datos SQLite embebida

### Interfaz
- Dise帽o retro-cyberpunk responsivo
- Notificaciones integradas en canvas
- Panel de configuraci贸n para anfitriones
- Lista de jugadores en l铆nea

## Tecnolog铆as

| Backend | Frontend | Database | Deploy |
|---------|----------|----------|---------|
| Node.js + Express | Vanilla JS + Canvas API | SQLite | Fly.io |
| Socket.IO | CSS3 Responsive | - | - |

## Instalaci贸n

```bash
git clone https://github.com/marto993/Snake-Multiplayer.git
cd snake-multiplayer
npm install
```

### Desarrollo
```bash
npm run dev
```

### Producci贸n
```bash
npm start
```

El servidor corre en `http://localhost:3000`. La base de datos SQLite se crea autom谩ticamente.

## Arquitectura

### Backend (`index.js`)
- Servidor Express con Socket.IO
- Gesti贸n de salas y estados de juego
- Sistema de proyectiles y consumibles
- Base de datos SQLite para estad铆sticas
- L贸gica de rondas y scoring

### Cliente (`SnakeGame.js`)
- Manejo de eventos Socket.IO
- Renderizado con Canvas API
- Interpolaci贸n de movimientos
- UI y sistema de notificaciones
- Gesti贸n de salas e invitaciones

### Clase Snake (`snakeClass.js`)
- L贸gica de movimiento con queue de inputs
- Sistema de consumibles temporales
- Interpolaci贸n cliente-servidor
- Mec谩nicas de ataque y crecimiento

### Base de Datos
```sql
-- Tabla de jugadores
players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  games_played INTEGER,
  wins INTEGER,
  total_score INTEGER,
  best_score INTEGER,
  rounds_won INTEGER,
  current_streak INTEGER,
  best_streak INTEGER,
  created_at DATETIME,
  last_played DATETIME
)
```

## Deployment (Fly.io)

El proyecto incluye configuraci贸n para Fly.io con volumen persistente para SQLite.

```bash
# Instalar Fly CLI
curl -L https://fly.io/install.sh | sh

# Deploy
fly deploy
```

Configuraci贸n en `fly.toml`:
- Regi贸n: Am茅rica del Sur (eze)
- Auto-scaling con hibernaci贸n
- 1GB RAM, 1 CPU compartida
- Volumen persistente en `/app/data`

## Estructura del Proyecto

```
snake-multiplayer/
鈹溾攢鈹€ index.js                 # Servidor principal
鈹溾攢鈹€ package.json             # Dependencias y scripts
鈹溾攢鈹€ fly.toml                 # Configuraci贸n Fly.io
鈹溾攢鈹€ public/
鈹?  鈹溾攢鈹€ index.html           # Interfaz completa
鈹?  鈹溾攢鈹€ SnakeGame.js         # Cliente principal
鈹?  鈹斺攢鈹€ snakeClass.js        # Clase Snake
鈹斺攢鈹€ game_stats.db           # Base de datos (auto-generada)
```


### Sistema de Sincronizaci贸n
- Estado autoritativo en servidor
- Predicci贸n en cliente con interpolaci贸n
- Reconciliaci贸n autom谩tica de diferencias
- Queue de movimientos para responsividad

### Consumibles Inteligentes
- Spawn din谩mico basado en jugadores activos
- Timers configurables por tipo
- Efectos temporales con cleanup autom谩tico
- Balanceo autom谩tico por sala

### Gesti贸n de Salas
- C贸digos 煤nicos auto-generados
- Migraci贸n autom谩tica de host
- Configuraciones sincronizadas en tiempo real
- Cleanup autom谩tico de salas inactivas

## Variables de Entorno

```bash
PORT=3000                    # Puerto del servidor
NODE_ENV=production         # Entorno de ejecuci贸n
```

## Contribuir

Las contribuciones son bienvenidas. Areas de inter茅s:
- Nuevos tipos de consumibles
- Modos de juego alternativos
- Optimizaciones de rendimiento
- Mejoras de UI/UX

## Licencia

MIT License - Uso libre para proyectos personales y comerciales.

---

<div align="center">

猸?Si te resulta 煤til, considera darle una estrella

馃悰 Issues y PRs son bienvenidos

---

**Desarrollado por [El Marto](https://github.com/marto993)**

[![GitHub](https://img.shields.io/badge/GitHub-marto993-100000?style=flat-square&logo=github)](https://github.com/marto993)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Martin%20Di%20Geronimo-0077B5?style=flat-square&logo=linkedin)](https://www.linkedin.com/in/martin-di-geronimo-29a06b17b)

</div>