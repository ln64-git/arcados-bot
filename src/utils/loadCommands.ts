// src/utils/loadCommands.ts
import { Client, Collection } from "discord.js";
import fs from "fs";
import { pathToFileURL, fileURLToPath } from "url";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

// ESM workaround for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function loadCommands(client: Client, commandsCollection: Collection<string, any>) {
  const commands = [];
  const commandsPath = path.join(__dirname, "../commands");
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(".ts") || file.endsWith(".js"));

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = await import(pathToFileURL(filePath).toString());

    if ("data" in command && "execute" in command) {
      commandsCollection.set(command.data.name, command);
      commands.push(command.data.toJSON());
    } else {
      console.warn(`🔸 Skipping ${file}: missing 'data' or 'execute'`);
    }
  }

  return commands; // Important for later registration
}
