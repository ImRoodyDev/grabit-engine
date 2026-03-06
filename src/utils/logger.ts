/**
 * Simple project-scoped logger utilities.
 * - Exports `CNPLogger` (default) and `ProxyLogger` for proxy-specific logs.
 * - Non-error levels are silenced when the logger is configured for production.
 */
// type LogLevel = "info" | "warn" | "error" | "debug";

/**
 * Lightweight logger class used across the project.
 * - When constructed with `debug: true`, logs are enabled (non-production mode).
 * - `enableDebugging` can toggle logging at runtime.
 * - `info`, `warn`, `debug` respect the production flag; `error` always logs.
 */
class DebugLogger {
	private isProduction: boolean = false;
	private timestamp: boolean = false;
	private jumpLine: boolean = false;
	private context: string = "LOGGER";

	/**
	 * Create a new Logger instance bound to a context label.
	 * @param debug When true, enables console output for non-error levels
	 * @param context A short label to include with each log message
	 */
	constructor(debug: boolean, context: string) {
		this.isProduction = !debug;
		this.context = context;
	}

	/**
	 * Toggle debugging (non-production) mode at runtime.
	 * @param enable `true` to enable debug logs; `false` to silence them
	 */
	public enableDebugging(enable: boolean): void {
		this.isProduction = !enable;
	}

	public setTimestamp(enabled: boolean): void {
		this.timestamp = enabled;
	}

	public setJumpLine(enabled: boolean): void {
		this.jumpLine = enabled;
	}

	private getTimestamp(): string {
		const now = new Date();
		const hh = String(now.getHours()).padStart(2, "0");
		const mm = String(now.getMinutes()).padStart(2, "0");
		const ss = String(now.getSeconds()).padStart(2, "0");
		const ms = String(now.getMilliseconds()).padStart(3, "0");
		return `${hh}:${mm}:${ss}:${ms}`;
	}

	private format(level: string, message: string): string {
		const color = this.getColor(level);
		const white = "\x1b[37m";
		const yellow = "\x1b[33m";
		const blue = "\x1b[34m";
		const green = "\x1b[32m";
		const reset = "\x1b[0m";
		const jumpLine = this.jumpLine ? "\n" : "";
		const timestamp = this.timestamp ? `${yellow}[${this.getTimestamp()}]${reset} ` : "";
		// context is green and level is blue;
		const context = `${green}[${this.context}]${blue} [${level.toUpperCase()}]:${reset} `;
		return `${timestamp}${context}${color}${message}${reset}${jumpLine}`;
	}

	/**
	 * Log an informational message when debugging is enabled.
	 */
	public info(message: string, ...optionalParams: unknown[]): void {
		if (!this.isProduction) {
			console.log(this.format("info", message), ...optionalParams);
		}
	}

	/**
	 * Log a warning message when debugging is enabled.
	 */
	public warn(message: string, ...optionalParams: unknown[]): void {
		if (!this.isProduction) {
			console.warn(this.format("warn", message), ...optionalParams);
		}
	}

	/**
	 * Always log a warning message, even in production mode.
	 * Use for validation / configuration issues that should never be silenced.
	 */
	public alwaysWarn(message: string, ...optionalParams: unknown[]): void {
		console.warn(this.format("warn", message), ...optionalParams);
	}

	/**
	 * Always log an error message.
	 */
	public error(message: string, ...optionalParams: unknown[]): void {
		console.error(this.format("error", message), ...optionalParams);
	}

	/**
	 * Log a debug message when debugging is enabled.
	 */
	public debug(message: string, ...optionalParams: unknown[]): void {
		if (!this.isProduction) {
			console.debug(this.format("debug", message), ...optionalParams);
		}
	}

	private getColor(level: string): string {
		switch (level) {
			case "info":
				return "\x1b[36m"; // Cyan
			case "warn":
				return "\x1b[33m"; // Yellow
			case "error":
				return "\x1b[31m"; // Red
			case "debug":
				return "\x1b[35m"; // Magenta
			default:
				return "\x1b[0m"; // Reset
		}
	}
}

/**
 * Default LOGGER FOR PACKAGE!!!.
 */
const _Logger = new DebugLogger(false, "GRABIT-ENGINE");

export { _Logger as Logger, DebugLogger };
