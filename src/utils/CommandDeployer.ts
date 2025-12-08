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
  private deploymentComplete: boolean = false;
  private deploymentPromise: Promise<void> | null = null;

  constructor(botToken: string, commands: Collection<string, Command>) {
    this.rest = new REST({ version: "10" }).setToken(botToken);
    this.commands = commands;
  }

  /**
   * Check if deployment has completed
   */
  isDeploymentComplete(): boolean {
    return this.deploymentComplete;
  }

  /**
   * Get the deployment promise (for waiting)
   */
  getDeploymentPromise(): Promise<void> | null {
    return this.deploymentPromise;
  }

  /**
   * Deploy commands to Discord
   * @param appId Discord application ID
   * @param guildId Optional guild ID for guild-specific deployment (faster for testing)
   */
  async deploy(appId: string, guildId?: string): Promise<void> {
    // Store the promise so we can wait for it
    this.deploymentComplete = false;
    this.deploymentPromise = this.deployAsync(appId, guildId).finally(() => {
      this.deploymentComplete = true;
    });
    return this.deploymentPromise;
  }

  private async deployAsync(appId: string, guildId?: string): Promise<void> {
    const maxRetries = 5;
    let retryCount = 0;
    let commandData: unknown[] | null = null;

    while (retryCount < maxRetries) {
      try {
        // Only load commands on first attempt, reuse on retries
        if (!commandData) {
          // Add timeout to loadCommands as well
          const loadPromise = loadCommands(this.commands);
          const loadTimeout = new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new Error("Command loading timed out after 20 seconds"));
            }, 20000); // 20 second timeout for loading
          });

          commandData = await Promise.race([loadPromise, loadTimeout]);
          console.log(`🔹 Deploying ${commandData.length} command(s)...`);
        } else if (retryCount > 0) {
          console.log(`🔹 Retrying deployment (${retryCount + 1}/${maxRetries})...`);
        }
        const deployPromise = guildId
          ? // Fast guild-specific deployment for testing
            this.rest.put(Routes.applicationGuildCommands(appId, guildId), {
              body: commandData,
            })
          : // Global deployment (takes up to an hour)
            this.rest.put(Routes.applicationCommands(appId), {
              body: commandData,
            });

        const deployTimeout = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error("Command deployment timed out after 5 seconds"));
          }, 5000); // 5 second timeout
        });

        await Promise.race([deployPromise, deployTimeout]);
        return; // Success, exit retry loop
      } catch (error) {
        retryCount++;
        if (retryCount >= maxRetries) {
          console.error(`🔸 Error deploying commands after ${maxRetries} attempts:`, error);
          // Don't throw - allow bot to continue even if command deployment fails
          // Commands might already be deployed from a previous run
          return;
        }
        
        console.warn(`🔸 Command deployment failed (attempt ${retryCount}/${maxRetries}), retrying immediately...`, error);
        // Retry immediately without waiting
      }
    }
  }
}
