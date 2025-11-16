/**
 * CommandDeployer
 *
 * Handles deployment of slash commands to Discord.
 * Supports both global and guild-specific deployments.
 */

import { REST, Routes, type Collection } from "discord.js";
import type { Command } from "../types";
import { loadCommands } from "./loadCommands";

export class CommandDeployer {
  private rest: REST;
  private commands: Collection<string, Command>;

  constructor(botToken: string, commands: Collection<string, Command>) {
    this.rest = new REST({ version: "10" }).setToken(botToken);
    this.commands = commands;
  }

  /**
   * Deploy commands to Discord
   * @param appId Discord application ID
   * @param guildId Optional guild ID for guild-specific deployment (faster for testing)
   */
  async deploy(appId: string, guildId?: string): Promise<void> {
    const commandData = await loadCommands(this.commands);

    if (guildId) {
      // Fast guild-specific deployment for testing
      console.log(
        `🔹 Deploying ${commandData.length} commands to guild ${guildId}...`
      );
      await this.rest.put(Routes.applicationGuildCommands(appId, guildId), {
        body: commandData,
      });
      console.log("✅ Guild commands deployed successfully");
    } else {
      // Global deployment (takes up to an hour)
      console.log(
        `🔹 Deploying ${commandData.length} commands globally (may take up to 1 hour)...`
      );
      await this.rest.put(Routes.applicationCommands(appId), {
        body: commandData,
      });
      console.log("✅ Global commands deployed successfully");
    }
  }
}
