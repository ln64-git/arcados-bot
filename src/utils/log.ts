/**
 * Centralized logging utilities for consistent log formatting across the application
 */

export enum LogLevel {
	INFO = "info",
	WARN = "warn",
	ERROR = "error",
	DEBUG = "debug",
}

export interface LogContext {
	operation?: string;
	userId?: string;
	channelId?: string;
	guildId?: string;
	duration?: number;
	[key: string]: unknown;
}

/**
 * Log an info message with consistent formatting
 * @param message The message to log
 * @param context Optional context information
 */
export function logInfo(message: string, context?: LogContext): void {
	const contextStr = context ? ` ${formatContext(context)}` : "";
	console.log(`🔹 ${message}${contextStr}`);
}

/**
 * Log a warning message with consistent formatting
 * @param message The message to log
 * @param context Optional context information
 */
export function logWarn(message: string, context?: LogContext): void {
	const contextStr = context ? ` ${formatContext(context)}` : "";
	console.warn(`🔸 ${message}${contextStr}`);
}

/**
 * Log an error message with consistent formatting
 * @param message The message to log
 * @param error Optional error object
 * @param context Optional context information
 */
export function logError(
	message: string,
	error?: unknown,
	context?: LogContext,
): void {
	const contextStr = context ? ` ${formatContext(context)}` : "";
	const errorStr = error ? `: ${error}` : "";
	console.error(`🔸 ${message}${errorStr}${contextStr}`);
}

/**
 * Log a debug message with consistent formatting
 * @param message The message to log
 * @param context Optional context information
 */
export function logDebug(message: string, context?: LogContext): void {
	const contextStr = context ? ` ${formatContext(context)}` : "";
	console.debug(`🔍 ${message}${contextStr}`);
}

/**
 * Log a success message with consistent formatting
 * @param message The message to log
 * @param context Optional context information
 */
export function logSuccess(message: string, context?: LogContext): void {
	const contextStr = context ? ` ${formatContext(context)}` : "";
	console.log(`✅ ${message}${contextStr}`);
}

/**
 * Log a performance metric with consistent formatting
 * @param operation The operation being measured
 * @param duration Duration in milliseconds
 * @param context Optional context information
 */
export function logPerformance(
	operation: string,
	duration: number,
	context?: LogContext,
): void {
	const contextStr = context ? ` ${formatContext(context)}` : "";
	const level = duration > 1000 ? "🔸" : duration > 500 ? "🔸" : "🔹";
	console.log(
		`${level} ${operation} took ${duration.toFixed(2)}ms${contextStr}`,
	);
}

/**
 * Format context object into a readable string
 * @param context The context object to format
 * @returns Formatted context string
 */
function formatContext(context: LogContext): string {
	const parts: string[] = [];

	if (context.operation) parts.push(`op:${context.operation}`);
	if (context.userId) parts.push(`user:${context.userId}`);
	if (context.channelId) parts.push(`channel:${context.channelId}`);
	if (context.guildId) parts.push(`guild:${context.guildId}`);
	if (context.duration !== undefined)
		parts.push(`duration:${context.duration}ms`);

	// Add any other context properties
	Object.entries(context).forEach(([key, value]) => {
		if (
			!["operation", "userId", "channelId", "guildId", "duration"].includes(key)
		) {
			parts.push(`${key}:${value}`);
		}
	});

	return `[${parts.join(", ")}]`;
}

/**
 * Create a logger instance for a specific module/feature
 * @param module The module name
 * @returns Logger instance with module context
 */
export function createLogger(module: string) {
	return {
		info: (message: string, context?: LogContext) =>
			logInfo(`${module}: ${message}`, context),
		warn: (message: string, context?: LogContext) =>
			logWarn(`${module}: ${message}`, context),
		error: (message: string, error?: unknown, context?: LogContext) =>
			logError(`${module}: ${message}`, error, context),
		debug: (message: string, context?: LogContext) =>
			logDebug(`${module}: ${message}`, context),
		success: (message: string, context?: LogContext) =>
			logSuccess(`${module}: ${message}`, context),
		performance: (operation: string, duration: number, context?: LogContext) =>
			logPerformance(`${module}: ${operation}`, duration, context),
	};
}
