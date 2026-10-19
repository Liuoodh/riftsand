/**
 * logger — the reference imports the `js-logger` package and calls
 * `Logger.useDefaults()` at module scope.
 *
 * Mini-game bundles have no npm resolution, so this is a four-level console
 * wrapper with the same call surface the game actually uses: `Logger.get(name)`,
 * `debug/info/warn/error`, and a settable global level. It is deliberately not a
 * feature-complete js-logger clone — handlers, formatters and timers are unused
 * by the reference's game code.
 */

export type LogLevel = 0 | 1 | 2 | 3 | 4;

const LEVEL_NAMES: Record<LogLevel, string> = {
    0: 'TRACE',
    1: 'DEBUG',
    2: 'INFO',
    3: 'WARN',
    4: 'ERROR',
};

class LoggerImpl {
    static TRACE: LogLevel = 0;
    static DEBUG: LogLevel = 1;
    static INFO: LogLevel = 2;
    static WARN: LogLevel = 3;
    static ERROR: LogLevel = 4;

    private level: LogLevel = 2;

    setLevel(level: LogLevel): void {
        this.level = level;
    }

    getLevel(): LogLevel {
        return this.level;
    }

    get(name: string): NamedLogger {
        return new NamedLogger(name, this);
    }

    enabled(level: LogLevel): boolean {
        return level >= this.level;
    }

    static get(name: string): NamedLogger {
        return defaultLogger.get(name);
    }

    static setLevel(level: LogLevel): void {
        defaultLogger.setLevel(level);
    }

    static getLevel(): LogLevel {
        return defaultLogger.getLevel();
    }

    static useDefaults(): void { /* no-op: console is the only sink */ }
}

export class NamedLogger {
    constructor(private name: string, private sink: LoggerImpl) {}

    private emit(level: LogLevel, args: any[]): void {
        if (!this.sink.enabled(level)) return;
        const prefix = `[${LEVEL_NAMES[level]}] ${this.name}:`;
        const fn =
            level >= LoggerImpl.ERROR ? console.error
                : level >= LoggerImpl.WARN ? console.warn
                    : console.log;
        fn.call(console, prefix, ...args);
    }

    trace(...args: any[]): void { this.emit(LoggerImpl.TRACE, args); }
    debug(...args: any[]): void { this.emit(LoggerImpl.DEBUG, args); }
    info(...args: any[]): void { this.emit(LoggerImpl.INFO, args); }
    warn(...args: any[]): void { this.emit(LoggerImpl.WARN, args); }
    error(...args: any[]): void { this.emit(LoggerImpl.ERROR, args); }
}

const defaultLogger = new LoggerImpl();

export const Logger = LoggerImpl;
export const AppLogger = defaultLogger;
export default defaultLogger;
