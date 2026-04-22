# ⚡ Viking Clan Wars - Middle Server

Este es el motor de juego (Game Engine) de **Viking Clan Wars**, encargado de gestionar la lógica en tiempo real, el estado de las partidas en memoria y la comunicación mediante WebSockets.

## 🛠️ Tecnologías

*   **Node.js**: Entorno de ejecución.
*   **Express**: Framework para la API HTTP (Login, Join Game).
*   **Socket.IO**: Comunicación bidireccional en tiempo real.
*   **JWT**: Autenticación segura.
*   **Pino**: Sistema de logging estructurado.

## 🏗️ Responsabilidades

1.  **Motor de Juego**: Controla el bucle de tiempo (*Time Wheel*) y las actualizaciones de recursos cada 30-60 segundos.
2.  **Estado en Memoria**: Mantiene el estado actual de todas las partidas activas para una respuesta inmediata.
3.  **Seguridad**: Valida todos los movimientos y acciones de los jugadores.
4.  **Integración**: Se comunica con el `DB Server` para persistir datos y con `Redis` para el control de sesiones.

## 🚀 Desarrollo

### Instalación de dependencias
```bash
npm install
```

### Ejecución en desarrollo
```bash
npm run dev
```

### Ejecución en producción
```bash
npm start
```

## 📄 Licencia

Este proyecto está bajo la **Licencia MIT (Modificada para uso educativo)**. Consulta el archivo [LICENSE](./LICENSE) para más detalles.
