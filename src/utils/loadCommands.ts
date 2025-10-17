// src/utils/loadCommands.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Collection } from "discord.js";
import dotenv from "dotenv";

dotenv.config();

// ESM workaround for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Command cache to avoid re-importing
const commandCache = new Map<string, unknown>();
const commandLoadTimes = new Map<string, number>();

export async function loadCommands(
	commandsCollection: Collection<string, unknown>,
) {
	const commands: unknown[] = [];
	const commandsPath = path.join(__dirname, "../commands");

	// Check if commands directory exists
	if (!fs.existsSync(commandsPath)) {
		console.warn("🔸 Commands directory not found");
		return commands;
	}

	const commandFiles = fs
		.readdirSync(commandsPath)
		.filter((file) => file.endsWith(".ts") || file.endsWith(".js"));

	// Load commands in parallel for better performance
	const loadPromises = commandFiles.map(async (file) => {
		const filePath = path.join(commandsPath, file);
		const cacheKey = filePath;

		// Check cache first
		if (commandCache.has(cacheKey)) {
			const cached = commandCache.get(cacheKey);
			return cached;
		}

		try {
			const commandModule = await import(pathToFileURL(filePath).toString());
			commandCache.set(cacheKey, commandModule);
			return commandModule;
		} catch (error) {
			console.error(`🔸 Error loading command file ${file}:`, error);
			return null;
		}
	});

	const commandModules = await Promise.all(loadPromises);

	// Process loaded modules
	for (let i = 0; i < commandModules.length; i++) {
		const commandModule = commandModules[i];
		const file = commandFiles[i];

		if (!commandModule) continue;

		// Look for command exports (e.g., muteCommand, deafenCommand, etc.)
		const commandExports = Object.values(commandModule).filter(
			(exported: unknown) =>
				exported &&
				typeof exported === "object" &&
				"data" in exported &&
				"execute" in exported,
		) as Array<{
			data: { name: string; toJSON: () => unknown };
			execute: unknown;
		}>;

		if (commandExports.length > 0) {
			for (const command of commandExports) {
				commandsCollection.set(command.data.name, command);
				commands.push(command.data.toJSON());
			}
		} else {
			console.warn(`🔸 Skipping ${file}: missing 'data' or 'execute'`);
		}
	}

	return commands; // Important for later registration
}

// Hot reload for development
export function clearCommandCache(): void {
	commandCache.clear();
	commandLoadTimes.clear();
}

// Get command loading statistics
export function getCommandStats(): {
	cachedCommands: number;
	loadTimes: Map<string, number>;
	averageLoadTime: number;
} {
	const loadTimes = new Map(commandLoadTimes);
	const averageLoadTime =
		loadTimes.size > 0
			? Array.from(loadTimes.values()).reduce((a, b) => a + b, 0) /
				loadTimes.size
			: 0;

	return {
		cachedCommands: commandCache.size,
		loadTimes,
		averageLoadTime,
	};
}
