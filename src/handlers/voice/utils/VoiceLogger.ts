import { config } from "../../../config/index.js";

export type VoiceLogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<VoiceLogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

export class VoiceLogger {
	private level: VoiceLogLevel;

	public constructor(private readonly source: string) {
		this.level = VoiceLogger.normalizeLevel(config.voiceAssistantLogLevel);
	}

	public setLevel(level: VoiceLogLevel): void {
		this.level = VoiceLogger.normalizeLevel(level);
	}

	public debug(message: string, ...args: unknown[]): void {
		this.log("debug", message, ...args);
	}

	public info(message: string, ...args: unknown[]): void {
		this.log("info", message, ...args);
	}

	public warn(message: string, ...args: unknown[]): void {
		this.log("warn", message, ...args);
	}

	public error(message: string, ...args: unknown[]): void {
		this.log("error", message, ...args);
	}

	private log(level: VoiceLogLevel, message: string, ...args: unknown[]): void {
		if (!this.shouldLog(level)) {
			return;
		}

		const prefix = `${this.source}`;

		switch (level) {
			case "debug":
				console.debug(prefix, message, ...args);
				break;
			case "info":
				console.log(prefix, message, ...args);
				break;
			case "warn":
				console.warn(prefix, message, ...args);
				break;
			case "error":
				console.error(prefix, message, ...args);
				break;
		}
	}

	private shouldLog(level: VoiceLogLevel): boolean {
		return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.level];
	}

	private static normalizeLevel(level: VoiceLogLevel | string | undefined): VoiceLogLevel {
		const normalized = (level || "info").toLowerCase();

		if (normalized === "debug" || normalized === "info" || normalized === "warn" || normalized === "error") {
			return normalized;
		}

		return "info";
	}
}


