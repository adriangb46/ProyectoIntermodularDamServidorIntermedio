/**
 * Logger estructurado personalizado (sin dependencias externas).
 * Emula la API de Pino pero usa console.log internamente.
 */

const isDevelopment = process.env.NODE_ENV !== 'production';
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL] ?? (isDevelopment ? 0 : 1);

const formatMsg = (level, msg, obj) => {
  if (isDevelopment) {
    // Formato legible para humanos (Pretty)
    const timestamp = new Date().toLocaleTimeString('es-ES', { hour12: false });
    const color = {
      debug: '\x1b[36m', // Cyan
      info: '\x1b[32m',  // Green
      warn: '\x1b[33m',  // Yellow
      error: '\x1b[31m', // Red
    }[level];
    const reset = '\x1b[0m';
    
    let extra = '';
    if (Object.keys(obj).length > 0) {
      extra = ` ${JSON.stringify(obj)}`;
    }
    
    return `${timestamp} ${color}${level.toUpperCase().padEnd(5)}${reset} ${msg}${extra}`;
  } else {
    // Formato JSON para producción
    return JSON.stringify({
      time: Date.now(),
      level,
      msg,
      ...obj
    });
  }
};

const write = (level, msg, obj = {}) => {
  if (LOG_LEVELS[level] < CURRENT_LEVEL) return;
  
  // Si el primer argumento es un objeto (estilo pino), intercambiamos
  if (typeof msg === 'object') {
    const temp = msg;
    msg = obj;
    obj = temp;
  }

  const output = formatMsg(level, msg, obj);
  
  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
};

export const logger = {
  debug: (obj, msg) => write('debug', msg, obj),
  info: (obj, msg) => write('info', msg, obj),
  warn: (obj, msg) => write('warn', msg, obj),
  error: (obj, msg) => write('error', msg, obj),
};

// Alias para facilitar migración
export const log = logger;
