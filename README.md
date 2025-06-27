# 🐍 Snake Multiplayer

[![Made with Node.js](https://img.shields.io/badge/Made%20with-Node.js-339933?style=flat-square&logo=node.js)](https://nodejs.org/)
[![Socket.IO](https://img.shields.io/badge/Real--time-Socket.IO-010101?style=flat-square&logo=socket.io)](https://socket.io/)
[![SQLite](https://img.shields.io/badge/Database-SQLite-003B57?style=flat-square&logo=sqlite)](https://sqlite.org/)
[![Deployed on Fly.io](https://img.shields.io/badge/Deployed-Fly.io-8B5CF6?style=flat-square)](https://fly.io/)

Juego Snake multijugador en tiempo real con salas privadas, sistema de combate y estadísticas persistentes.

## Características

### Multijugador en Tiempo Real
- Hasta 16 jugadores por sala
- Salas con códigos únicos de 6 caracteres
- Sistema de invitaciones entre jugadores
- Sincronización client-server con interpolación suave

### Mecánicas de Juego
- **Partidas por rondas**: 3 rondas de 60 segundos cada una
- **Sistema de combate**: Proyectiles que reducen el tamaño de otros jugadores
- **Consumibles**: Power-ups como inmunidad temporal
- **Portales**: Teletransporte en los bordes del mapa
- **Configuración personalizable**: Velocidad, tamaño de segmentos, consumibles

### Persistencia de Datos
- Perfiles de usuario con estadísticas completas
- Rankings globales por victorias y winrate
- Reconexión automática con sesiones persistentes
- Base de datos SQLite embebida

### Interfaz
- Diseño retro-cyberpunk
- Notificaciones integradas en canvas
- Panel de configuración para anfitriones
- Lista de jugadores en línea con posibilidad de enviar invitación

## Tecnologías

| Backend | Frontend | Database | Deploy |
|---------|----------|----------|---------|
| Node.js + Express | Vanilla JS + Canvas API | SQLite | Fly.io |
| Socket.IO | CSS3 Responsive | - | - |

## Instalación

```bash
git clone https://github.com/marto993/Snake-Multiplayer.git
cd snake-multiplayer
npm install
```

### Desarrollo
```bash
npm run dev
```

### Producción
```bash
npm start
```

El servidor corre en `http://localhost:3000`. La base de datos SQLite se crea automáticamente.

## Arquitectura

### Backend (`index.js`)
- Servidor Express con Socket.IO
- Gestión de salas y estados de juego
- Sistema de proyectiles y consumibles
- Base de datos SQLite para estadísticas
- Lógica de rondas y scoring

### Cliente (`SnakeGame.js`)
- Manejo de eventos Socket.IO
- Renderizado con Canvas API
- Interpolación de movimientos
- UI y sistema de notificaciones
- Gestión de salas e invitaciones

### Clase Snake (`snakeClass.js`)
- Lógica de movimiento con queue de inputs
- Sistema de consumibles temporales
- Interpolación cliente-servidor
- Mecánicas de ataque y crecimiento

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

El proyecto incluye configuración para Fly.io con volumen persistente para SQLite.

```bash
# Instalar Fly CLI
curl -L https://fly.io/install.sh | sh

# Deploy
fly deploy
```

Configuración en `fly.toml`:
- Región: América del Sur (eze)
- Auto-scaling con hibernación
- 1GB RAM, 1 CPU compartida
- Volumen persistente en `/app/data`

## Estructura del Proyecto

```
snake-multiplayer/
├── index.js                 # Servidor principal
├── package.json             # Dependencias y scripts
├── fly.toml                 # Configuración Fly.io
├── public/
│   ├── index.html           # Interfaz completa
│   ├── SnakeGame.js         # Cliente principal
│   └── snakeClass.js        # Clase Snake
└── game_stats.db           # Base de datos (auto-generada)
```


### Sistema de Sincronización
- Estado autoritativo en servidor
- Predicción en cliente con interpolación
- Reconciliación automática de diferencias
- Queue de movimientos para responsividad

### Consumibles Inteligentes
- Spawn dinámico basado en jugadores activos
- Timers configurables por tipo
- Efectos temporales con cleanup automático
- Balanceo automático por sala

### Gestión de Salas
- Códigos únicos auto-generados
- Migración automática de host
- Configuraciones sincronizadas en tiempo real
- Cleanup automático de salas inactivas

## Variables de Entorno

```bash
PORT=3000                    # Puerto del servidor
NODE_ENV=production         # Entorno de ejecución
```

## Contribuir

Las contribuciones son bienvenidas. Areas de interés:
- Nuevos tipos de consumibles
- Modos de juego alternativos
- Optimizaciones de rendimiento
- Mejoras de UI/UX

## Licencia

MIT License - Uso libre para proyectos personales y comerciales.

---

<div align="center">

⭐ Si te resulta útil, considera darle una estrella

🐛 Issues y PRs son bienvenidos

---

**Desarrollado por [El Marto](https://github.com/marto993)**

[![GitHub](https://img.shields.io/badge/GitHub-marto993-100000?style=flat-square&logo=github)](https://github.com/marto993)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Martin%20Di%20Geronimo-0077B5?style=flat-square&logo=linkedin)](https://www.linkedin.com/in/martin-di-geronimo-29a06b17b)

</div>