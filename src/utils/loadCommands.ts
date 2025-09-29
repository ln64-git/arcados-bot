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

export async function loadCommands(
	commandsCollection: Collection<string, unknown>,
) {
	const commands = [];
	const commandsPath = path.join(__dirname, "../commands");
	const commandFiles = fs
		.readdirSync(commandsPath)
		.filter((file) => file.endsWith(".ts") || file.endsWith(".js"));

	for (const file of commandFiles) {
		const filePath = path.join(commandsPath, file);
		const commandModule = await import(pathToFileURL(filePath).toString());

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
