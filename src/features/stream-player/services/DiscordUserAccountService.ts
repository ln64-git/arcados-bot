import type { Page, Browser } from "puppeteer";
import { config } from "../../../config/index.js";
import { STREAM_CONSTANTS } from "../constants.js";

/**
 * Helper function to wait/delay (replacement for deprecated waitForTimeout)
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Service for managing Discord user account login and Go Live streaming via Puppeteer
 *
 * This service uses a separate Discord user account (not the bot account) to:
 * 1. Sign into Discord web client
 * 2. Join a voice channel
 * 3. Start Go Live streaming
 * 4. Stream browser content to Discord
 *
 * NOTE: Using user accounts for automation may violate Discord ToS.
 * Use at your own risk and with a dedicated account.
 */
export class DiscordUserAccountService {
  private browser: Browser | null = null;
  private discordPage: Page | null = null;
  private isLoggedIn = false;

  /**
   * Initialize with browser instance
   */
  async initialize(browser: Browser): Promise<void> {
    this.browser = browser;
  }

  /**
   * Sign into Discord using user account credentials
   */
  async signIn(): Promise<void> {
    if (!this.browser) {
      throw new Error("Browser not initialized");
    }

    if (this.isLoggedIn && this.discordPage) {
      console.log("[DiscordUserAccountService] Already signed in");
      return;
    }

    // Check if credentials are provided
    if (!config.streamPlayerUserEmail || !config.streamPlayerUserPassword) {
      if (!config.streamPlayerUserToken) {
        throw new Error(
          "Discord user account credentials not configured. " +
            "Set STREAM_PLAYER_USER_EMAIL and STREAM_PLAYER_USER_PASSWORD, " +
            "or STREAM_PLAYER_USER_TOKEN in .env"
        );
      }
    }

    try {
      // Create new page for Discord
      this.discordPage = await this.browser.newPage();

      // Set user agent
      await this.discordPage.setUserAgent(
        config.streamPlayerUserAgent || STREAM_CONSTANTS.DEFAULT_USER_AGENT
      );

      // Navigate to Discord login
      await this.discordPage.goto("https://discord.com/login", {
        waitUntil: "networkidle2",
        timeout: STREAM_CONSTANTS.PAGE_LOAD_TIMEOUT,
      });

      // Check if already logged in (cookies from profile)
      const alreadyLoggedIn = await this.discordPage.evaluate(() => {
        // Check if we're already on the app page or channels page
        return (
          window.location.pathname.includes("/channels") ||
          window.location.pathname.includes("/app") ||
          document.querySelector('[class*="app"]') !== null ||
          document.querySelector('[data-list-item-id*="guildsnav"]') !== null
        );
      });

      if (alreadyLoggedIn) {
        console.log(
          "[DiscordUserAccountService] Already logged in (via cookies/profile)"
        );
        this.isLoggedIn = true;
        return;
      }

      console.log(
        "[DiscordUserAccountService] Not logged in, proceeding with login..."
      );

      // Wait for login form
      await this.discordPage.waitForSelector('input[name="email"]', {
        timeout: STREAM_CONSTANTS.PAGE_LOAD_TIMEOUT,
      });

      // Fill in credentials
      await this.discordPage.type(
        'input[name="email"]',
        config.streamPlayerUserEmail!
      );
      await this.discordPage.type(
        'input[name="password"]',
        config.streamPlayerUserPassword!
      );

      // Click login button
      await this.discordPage.click('button[type="submit"]');

      // Wait for login to complete (check for main app or home page)
      await this.discordPage.waitForNavigation({
        waitUntil: "networkidle2",
        timeout: STREAM_CONSTANTS.PAGE_LOAD_TIMEOUT,
      });

      // Verify we're logged in by checking for Discord app elements
      await this.discordPage.waitForSelector('[class*="app"]', {
        timeout: STREAM_CONSTANTS.PAGE_LOAD_TIMEOUT,
      });

      this.isLoggedIn = true;
      console.log(
        "[DiscordUserAccountService] Successfully signed into Discord"
      );
    } catch (error) {
      console.error("[DiscordUserAccountService] Failed to sign in:", error);
      if (this.discordPage) {
        await this.discordPage.close();
        this.discordPage = null;
      }
      throw error;
    }
  }

  /**
   * Navigate to voice channel page (prepare for joining, but don't join yet)
   * This is useful for YouTube workflow where we prepare before user selects a video
   *
   * @param guildId Discord guild ID
   * @param channelId Discord voice channel ID
   */
  async navigateToVoiceChannel(
    guildId: string,
    channelId: string
  ): Promise<void> {
    if (!this.discordPage || !this.isLoggedIn) {
      await this.signIn();
    }

    if (!this.discordPage) {
      throw new Error("Discord page not available");
    }

    try {
      // Navigate to the voice channel
      // Discord URL format: https://discord.com/channels/{guildId}/{channelId}
      const channelUrl = `https://discord.com/channels/${guildId}/${channelId}`;
      await this.discordPage.goto(channelUrl, {
        waitUntil: "networkidle2",
        timeout: STREAM_CONSTANTS.PAGE_LOAD_TIMEOUT,
      });

      // Wait for voice channel UI to load
      await this.discordPage.waitForSelector('[class*="voice"]', {
        timeout: STREAM_CONSTANTS.PAGE_LOAD_TIMEOUT,
      });

      console.log(
        `[DiscordUserAccountService] Navigated to voice channel ${channelId}, ready to join when video is selected`
      );
    } catch (error) {
      console.error(
        "[DiscordUserAccountService] Failed to navigate to voice channel:",
        error
      );
      throw error;
    }
  }

  /**
   * Join a voice channel and start Go Live streaming
   *
   * @param guildId Discord guild ID
   * @param channelId Discord voice channel ID
   * @param contentPage Puppeteer page with the content to stream
   */
  async joinAndStream(
    guildId: string,
    channelId: string,
    contentPage: Page
  ): Promise<void> {
    if (!this.discordPage || !this.isLoggedIn) {
      await this.signIn();
    }

    if (!this.discordPage) {
      throw new Error("Discord page not available");
    }

    try {
      // Step 1: Click on the server/guild in the sidebar
      console.log(
        `[DiscordUserAccountService] Step 1: Clicking on server ${guildId} in sidebar...`
      );

      // First, wait for the sidebar to be visible
      try {
        await this.discordPage.waitForSelector(
          '[class*="guild"], [class*="server"], [data-list-item-id*="guildsnav"]',
          {
            timeout: 10000,
          }
        );
        console.log(`[DiscordUserAccountService] Sidebar is visible`);
      } catch (error) {
        console.warn(
          `[DiscordUserAccountService] Sidebar not found, continuing anyway...`
        );
      }

      // Helper function to click an element with multiple methods
      const clickElement = async (element: any, description: string) => {
        try {
          // Method 1: Standard click
          await element.click({ delay: 100 });
          console.log(
            `[DiscordUserAccountService] ${description} - Standard click succeeded`
          );
          return true;
        } catch (error1) {
          console.log(
            `[DiscordUserAccountService] ${description} - Standard click failed, trying mouse events...`
          );
          try {
            // Method 2: Mouse events
            const box = await element.boundingBox();
            if (box && this.discordPage) {
              await this.discordPage.mouse.move(
                box.x + box.width / 2,
                box.y + box.height / 2
              );
              await delay(100);
              await this.discordPage.mouse.down();
              await delay(50);
              await this.discordPage.mouse.up();
              console.log(
                `[DiscordUserAccountService] ${description} - Mouse click succeeded`
              );
              return true;
            }
          } catch (error2) {
            console.log(
              `[DiscordUserAccountService] ${description} - Mouse click failed, trying evaluate click...`
            );
            try {
              // Method 3: Evaluate click
              await element.evaluate((el: HTMLElement) => {
                el.click();
              });
              console.log(
                `[DiscordUserAccountService] ${description} - Evaluate click succeeded`
              );
              return true;
            } catch (error3) {
              console.error(
                `[DiscordUserAccountService] ${description} - All click methods failed:`,
                error3
              );
              return false;
            }
          }
        }
        return false;
      };

      // Try to find and click the server icon using Puppeteer's native methods
      let serverClicked = false;

      // Try exact selector first - the element with role="treeitem" and data-list-item-id
      try {
        const guildSelector = `[data-list-item-id="guildsnav___${guildId}"]`;
        await this.discordPage.waitForSelector(guildSelector, {
          timeout: 10000,
          visible: true,
        });
        const guildElement = await this.discordPage.$(guildSelector);
        if (guildElement) {
          console.log(
            `[DiscordUserAccountService] Found guild element with selector: ${guildSelector}`
          );
          // Scroll into view using evaluate
          await guildElement.evaluate((el) =>
            el.scrollIntoView({ behavior: "smooth", block: "center" })
          );
          await delay(1000); // Wait for scroll animation

          // Try clicking the element itself first
          serverClicked = await clickElement(guildElement, "Guild element");

          // If direct click fails, try clicking the parent blobContainer
          if (!serverClicked) {
            console.log(
              `[DiscordUserAccountService] Direct click failed, trying parent container...`
            );
            const parentInfo = await guildElement.evaluate((el) => {
              // Find the parent blobContainer
              let current = el.parentElement;
              while (current) {
                if (
                  current.classList.contains("blobContainer") ||
                  current.getAttribute("data-dnd-name")
                ) {
                  return {
                    found: true,
                    className: current.className,
                    dataDndName: current.getAttribute("data-dnd-name"),
                  };
                }
                current = current.parentElement;
              }
              return { found: false };
            });

            if (parentInfo.found) {
              // Try to find and click the blobContainer using a different selector
              const blobContainerSelector = `[data-dnd-name][data-list-item-id*="${guildId}"], .blobContainer[data-list-item-id*="${guildId}"]`;
              try {
                const blobContainer = await this.discordPage.$(
                  blobContainerSelector
                );
                if (blobContainer) {
                  await blobContainer.evaluate((el) =>
                    el.scrollIntoView({ behavior: "smooth", block: "center" })
                  );
                  await delay(500);
                  serverClicked = await clickElement(
                    blobContainer,
                    "BlobContainer parent"
                  );
                } else {
                  // Try finding by data-dnd-name
                  const allBlobContainers = await this.discordPage.$$(
                    ".blobContainer, [data-dnd-name]"
                  );
                  for (const container of allBlobContainers) {
                    const hasGuildId = await container.evaluate(
                      (el, targetId) => {
                        const dataId =
                          el.getAttribute("data-list-item-id") || "";
                        const dndName = el.getAttribute("data-dnd-name") || "";
                        return (
                          dataId.includes(targetId) ||
                          el.querySelector(
                            `[data-list-item-id*="${targetId}"]`
                          ) !== null
                        );
                      },
                      guildId
                    );

                    if (hasGuildId) {
                      await container.evaluate((el) =>
                        el.scrollIntoView({
                          behavior: "smooth",
                          block: "center",
                        })
                      );
                      await delay(500);
                      serverClicked = await clickElement(
                        container,
                        "BlobContainer by search"
                      );
                      if (serverClicked) break;
                    }
                  }
                }
              } catch (error) {
                console.error(
                  `[DiscordUserAccountService] Failed to click parent container:`,
                  error
                );
              }
            }
          }
        }
      } catch (error) {
        console.error(
          `[DiscordUserAccountService] Exact selector failed:`,
          error
        );
      }

      // If exact selector failed, try finding by searching all guild elements
      if (!serverClicked) {
        console.log(
          `[DiscordUserAccountService] Trying fallback search for guild element...`
        );
        const serverInfo = await this.discordPage.evaluate((targetGuildId) => {
          // Try multiple selectors
          const selectors = [
            `[data-list-item-id="guildsnav___${targetGuildId}"]`,
            `[data-list-item-id*="guildsnav"][data-list-item-id*="${targetGuildId}"]`,
            `[data-list-item-id*="${targetGuildId}"]`,
            `[data-dnd-name][data-list-item-id*="${targetGuildId}"]`,
            `div[role="treeitem"][data-list-item-id*="${targetGuildId}"]`,
          ];

          for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
              // Also try to find parent blobContainer
              let clickableElement = element as HTMLElement;
              let parent = element.parentElement;
              while (parent) {
                if (
                  parent.classList.contains("blobContainer") ||
                  parent.getAttribute("data-dnd-name")
                ) {
                  clickableElement = parent as HTMLElement;
                  break;
                }
                parent = parent.parentElement;
              }

              return {
                found: true,
                selector,
                tagName: clickableElement.tagName,
                dataId:
                  clickableElement.getAttribute("data-list-item-id") ||
                  element.getAttribute("data-list-item-id"),
                className: clickableElement.className,
                isParent: clickableElement !== element,
              };
            }
          }

          // Search all elements with data-list-item-id
          const allGuildElements = document.querySelectorAll(
            '[data-list-item-id*="guildsnav"], [role="treeitem"][data-list-item-id], [data-dnd-name]'
          );
          const matches: Array<{
            dataId: string;
            tagName: string;
            className: string;
            dataDndName: string;
          }> = [];

          for (const element of Array.from(allGuildElements).slice(0, 20)) {
            const el = element as HTMLElement;
            const dataId = el.getAttribute("data-list-item-id") || "";
            const dataDndName = el.getAttribute("data-dnd-name") || "";
            if (
              dataId.includes(targetGuildId) ||
              dataId.includes("guildsnav") ||
              dataDndName
            ) {
              matches.push({
                dataId,
                tagName: el.tagName,
                className: el.className || "",
                dataDndName,
              });
            }
          }

          return {
            found: false,
            availableGuilds: matches,
          };
        }, guildId);

        if (serverInfo.found) {
          console.log(
            `[DiscordUserAccountService] Found guild element via fallback:`,
            serverInfo
          );
          // Click using the found selector
          const element = await this.discordPage.$(serverInfo.selector!);
          if (element) {
            // If we found a parent container, try to get it
            let clickableElement = element;
            if (serverInfo.isParent) {
              const parentHandle = await element.evaluateHandle((el) => {
                let current = el.parentElement;
                while (current) {
                  if (
                    current.classList.contains("blobContainer") ||
                    current.getAttribute("data-dnd-name")
                  ) {
                    return current;
                  }
                  current = current.parentElement;
                }
                return el;
              });
              const parentElement = parentHandle.asElement();
              if (parentElement) {
                clickableElement = parentElement as any;
              }
            }

            await clickableElement.evaluate((el) =>
              el.scrollIntoView({ behavior: "smooth", block: "center" })
            );
            await delay(1000);
            serverClicked = await clickElement(
              clickableElement,
              "Guild element via fallback"
            );
          }
        } else {
          console.warn(
            `[DiscordUserAccountService] Could not find guild element for ${guildId}`
          );
          console.log(
            `[DiscordUserAccountService] Available guild elements:`,
            serverInfo.availableGuilds
          );
        }
      }

      if (serverClicked) {
        console.log(
          `[DiscordUserAccountService] Clicked on server, waiting for it to load...`
        );
        await delay(3000); // Wait for server to load

        // Verify that server loaded by checking if channel list appeared
        const serverLoaded = await this.discordPage.evaluate(() => {
          return (
            document.querySelector('[data-list-item-id*="channels"]') !== null
          );
        });

        if (serverLoaded) {
          console.log(
            `[DiscordUserAccountService] ✓ Server loaded successfully (channel list visible)`
          );
        } else {
          console.warn(
            `[DiscordUserAccountService] ✗ Server may not have loaded (channel list not visible)`
          );
          // Take screenshot for debugging
          await this.discordPage.screenshot({
            path: `/tmp/discord-server-load-failed-${Date.now()}.png`,
          });
        }
      } else {
        console.warn(
          `[DiscordUserAccountService] Could not find server in sidebar, trying direct navigation...`
        );
        // Take screenshot before fallback
        await this.discordPage.screenshot({
          path: `/tmp/discord-server-click-failed-${Date.now()}.png`,
        });

        // Fallback: navigate directly to the channel URL
        const channelUrl = `https://discord.com/channels/${guildId}/${channelId}`;
        await this.discordPage.goto(channelUrl, {
          waitUntil: "networkidle2",
          timeout: STREAM_CONSTANTS.PAGE_LOAD_TIMEOUT,
        });
        await delay(2000);
      }

      // Step 2: Find and click on the voice channel in the channel list
      console.log(
        `[DiscordUserAccountService] Step 2: Looking for voice channel ${channelId}...`
      );

      // Wait for channel list to be visible
      try {
        await this.discordPage.waitForSelector(
          '[data-list-item-id*="channels"]',
          {
            timeout: 10000,
          }
        );
      } catch (error) {
        console.warn(
          "[DiscordUserAccountService] Channel list not found, continuing anyway..."
        );
      }

      const channelClicked = await this.discordPage.evaluate(
        (targetChannelId) => {
          // Find the channel element by data-list-item-id
          // Format: data-list-item-id="channels___{channelId}"
          // It's an <a> tag with role="button"
          const channelSelector = `a[data-list-item-id="channels___${targetChannelId}"], [data-list-item-id="channels___${targetChannelId}"]`;
          let channelElement = document.querySelector(
            channelSelector
          ) as HTMLElement;

          if (channelElement) {
            console.log(
              `[DiscordUserAccountService] Found channel element with selector: ${channelSelector}`
            );
            // Scroll into view
            channelElement.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
            channelElement.click();
            return true;
          }

          // Alternative: search all channel elements (look for <a> tags specifically)
          const channelLinks = document.querySelectorAll(
            'a[data-list-item-id*="channels"], a[role="button"][data-list-item-id]'
          );
          for (const element of Array.from(channelLinks)) {
            const el = element as HTMLElement;
            const dataId = el.getAttribute("data-list-item-id") || "";
            if (
              dataId === `channels___${targetChannelId}` ||
              dataId.includes(targetChannelId)
            ) {
              console.log(
                `[DiscordUserAccountService] Found channel element by searching, clicking...`
              );
              el.scrollIntoView({ behavior: "smooth", block: "center" });
              el.click();
              return true;
            }
          }

          // Also try finding by any element with the channel ID
          const allElements = document.querySelectorAll("[data-list-item-id]");
          for (const element of Array.from(allElements)) {
            const el = element as HTMLElement;
            const dataId = el.getAttribute("data-list-item-id") || "";
            if (dataId === `channels___${targetChannelId}`) {
              console.log(
                `[DiscordUserAccountService] Found channel element by searching all elements, clicking...`
              );
              el.scrollIntoView({ behavior: "smooth", block: "center" });
              el.click();
              return true;
            }
          }

          console.warn(
            `[DiscordUserAccountService] Could not find channel element for ${targetChannelId}`
          );
          // Debug: log available channel elements
          const availableChannels = Array.from(
            document.querySelectorAll('[data-list-item-id*="channels"]')
          )
            .slice(0, 5)
            .map((el) => ({
              dataId: el.getAttribute("data-list-item-id"),
              tagName: el.tagName,
              ariaLabel: el.getAttribute("aria-label"),
            }));
          console.log(
            `[DiscordUserAccountService] Available channel elements:`,
            availableChannels
          );
          return false;
        },
        channelId
      );

      if (channelClicked) {
        console.log(
          `[DiscordUserAccountService] Clicked on voice channel, waiting for it to load...`
        );
        // Wait for scroll animation and navigation
        await delay(1000);
        // Wait for channel page to load
        await delay(3000);

        // Verify that voice channel page loaded
        const voiceUILoaded = await this.discordPage.evaluate(() => {
          // Check if we can see voice-related UI elements
          const hasVoiceControls =
            document.querySelector(
              'button[aria-label*="voice" i], button[aria-label*="join" i], button[aria-label*="connect" i]'
            ) !== null;
          const hasDisconnectButton =
            document.querySelector(
              'button[aria-label*="disconnect" i], button[aria-label*="leave" i]'
            ) !== null;
          return hasVoiceControls || hasDisconnectButton;
        });

        if (voiceUILoaded) {
          console.log(
            `[DiscordUserAccountService] ✓ Voice channel UI loaded successfully`
          );
        } else {
          console.warn(
            `[DiscordUserAccountService] ✗ Voice channel UI may not have loaded`
          );
          // Take screenshot for debugging
          await this.discordPage.screenshot({
            path: `/tmp/discord-voice-ui-failed-${Date.now()}.png`,
          });
        }

        // Check if we're now in the voice channel (clicking the channel should join automatically)
        const isInChannel = await this.discordPage.evaluate(() => {
          // Look for indicators that we're connected to voice
          const indicators = [
            'button[aria-label*="disconnect" i]',
            'button[aria-label*="leave" i]',
            '[class*="connected"]',
            '[class*="joined"]',
            '[class*="speaking"]',
          ];
          for (const selector of indicators) {
            if (document.querySelector(selector)) {
              return true;
            }
          }
          return false;
        });

        if (isInChannel) {
          console.log(
            `[DiscordUserAccountService] ✓ Successfully joined voice channel by clicking channel element`
          );
        } else {
          console.log(
            `[DiscordUserAccountService] → Not yet in voice channel, will look for join button...`
          );
        }
      } else {
        console.warn(
          `[DiscordUserAccountService] Could not find voice channel, trying direct navigation...`
        );
        // Take screenshot before fallback
        await this.discordPage.screenshot({
          path: `/tmp/discord-channel-click-failed-${Date.now()}.png`,
        });

        // Fallback: navigate directly to the channel URL
        const channelUrl = `https://discord.com/channels/${guildId}/${channelId}`;
        await this.discordPage.goto(channelUrl, {
          waitUntil: "networkidle2",
          timeout: STREAM_CONSTANTS.PAGE_LOAD_TIMEOUT,
        });
        await delay(2000);
      }

      // Wait for voice channel UI to load
      try {
        await this.discordPage.waitForSelector(
          '[class*="voice"], [class*="channel"], button',
          {
            timeout: 10000,
          }
        );
      } catch (error) {
        console.warn(
          "[DiscordUserAccountService] Voice channel UI elements not found, continuing anyway..."
        );
      }

      // Click "Join Voice" or "Connect" button
      // Discord's UI may vary, so we'll try multiple approaches
      let joined = false;

      console.log(
        "[DiscordUserAccountService] Attempting to join voice channel..."
      );

      // Wait a bit for page to fully load
      await delay(2000);

      // Close any modals or permission dialogs that might be blocking
      try {
        await this.discordPage.evaluate(() => {
          // Look for and close modals
          const modals = document.querySelectorAll(
            '[role="dialog"], [class*="modal"], [class*="overlay"]'
          );
          for (const modal of Array.from(modals)) {
            const closeBtn = modal.querySelector(
              'button[aria-label*="close" i], button[aria-label*="dismiss" i], button:has-text("×"), button:has-text("X")'
            );
            if (closeBtn) {
              (closeBtn as HTMLElement).click();
            }
          }
          // Press Escape to close any dialogs
          document.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              keyCode: 27,
              bubbles: true,
            })
          );
        });
        await delay(1000);
      } catch (error) {
        // Ignore modal closing errors
      }

      // Try finding join button by multiple methods
      // First, wait for the page to be interactive
      try {
        await this.discordPage.waitForSelector('button, [role="button"]', {
          timeout: 10000,
        });
      } catch (error) {
        console.warn(
          "[DiscordUserAccountService] Buttons not found, continuing anyway..."
        );
      }

      joined = await this.discordPage.evaluate(() => {
        // Get all buttons and clickable elements
        const buttons = Array.from(
          document.querySelectorAll("button, [role='button']")
        );

        // Try to find join button by various methods
        let joinButton: HTMLElement | null = null;

        // Method 1: By aria-label (most reliable)
        for (const btn of buttons) {
          const label = btn.getAttribute("aria-label")?.toLowerCase() || "";
          if (
            (label.includes("join") && label.includes("voice")) ||
            label.includes("connect to voice") ||
            label === "join voice channel" ||
            label === "join call"
          ) {
            joinButton = btn as HTMLElement;
            break;
          }
        }

        // Method 2: By text content
        if (!joinButton) {
          for (const btn of buttons) {
            const text = btn.textContent?.toLowerCase().trim() || "";
            if (
              text === "join voice" ||
              text === "join" ||
              text === "connect" ||
              (text.includes("join") && text.includes("voice"))
            ) {
              joinButton = btn as HTMLElement;
              break;
            }
          }
        }

        // Method 3: Look in specific containers (Discord's UI structure)
        if (!joinButton) {
          // Look in the channel header area
          const channelHeader = document.querySelector(
            '[class*="header"], [class*="title"]'
          );
          if (channelHeader) {
            const headerButtons = Array.from(
              channelHeader.querySelectorAll("button")
            );
            for (const btn of headerButtons) {
              const text = btn.textContent?.toLowerCase() || "";
              const label = btn.getAttribute("aria-label")?.toLowerCase() || "";
              if (text.includes("join") || label.includes("join")) {
                joinButton = btn as HTMLElement;
                break;
              }
            }
          }
        }

        // Method 4: Look for buttons in voice channel area
        if (!joinButton) {
          const voiceAreas = document.querySelectorAll(
            '[class*="voice"], [class*="channel"], [class*="container"]'
          );
          for (const voiceArea of Array.from(voiceAreas)) {
            const areaButtons = Array.from(
              voiceArea.querySelectorAll("button")
            );
            for (const btn of areaButtons) {
              const text = btn.textContent?.toLowerCase() || "";
              const label = btn.getAttribute("aria-label")?.toLowerCase() || "";
              if (
                text.includes("join") ||
                text.includes("connect") ||
                label.includes("join") ||
                label.includes("connect")
              ) {
                joinButton = btn as HTMLElement;
                break;
              }
            }
            if (joinButton) break;
          }
        }

        if (
          joinButton &&
          !(joinButton as HTMLButtonElement).disabled &&
          joinButton.offsetParent !== null
        ) {
          console.log(
            "[DiscordUserAccountService] Found join button, clicking..."
          );
          // Scroll into view if needed
          joinButton.scrollIntoView({ behavior: "smooth", block: "center" });
          joinButton.click();
          return true;
        }

        return false;
      });

      if (joined) {
        console.log(
          "[DiscordUserAccountService] Join button clicked, waiting for connection..."
        );
        // Wait a bit for scroll animation
        await delay(500);
        // Wait longer for connection to establish
        await delay(5000);
      } else {
        console.warn(
          "[DiscordUserAccountService] Could not find join button, trying alternative methods"
        );

        // Alternative: try clicking on voice channel area directly or using keyboard
        console.log(
          "[DiscordUserAccountService] Trying alternative join methods..."
        );

        // Try clicking the channel name/header
        const clicked = await this.discordPage.evaluate(() => {
          // Look for the channel name or header that might be clickable
          const channelName = document.querySelector(
            'h1, [class*="name"], [class*="title"]'
          );
          if (channelName) {
            (channelName as HTMLElement).click();
            return true;
          }
          return false;
        });

        if (clicked) {
          console.log("[DiscordUserAccountService] Clicked channel name");
          await delay(2000);
        }

        // Try pressing Enter key (sometimes Discord responds to Enter in voice channels)
        try {
          await this.discordPage.keyboard.press("Enter");
          await delay(1000);
          console.log("[DiscordUserAccountService] Pressed Enter key");
        } catch (error) {
          // Ignore
        }

        await delay(3000);
      }

      // Verify we're connected by checking for connection indicators
      const isConnected = await this.discordPage.evaluate(() => {
        // Look for indicators that we're in a voice channel
        const indicators = [
          '[class*="connected"]',
          '[class*="joined"]',
          '[class*="speaking"]',
          'button[aria-label*="disconnect"]',
          'button[aria-label*="leave"]',
        ];

        for (const selector of indicators) {
          if (document.querySelector(selector)) {
            return true;
          }
        }
        return false;
      });

      if (isConnected) {
        console.log(
          "[DiscordUserAccountService] Successfully joined voice channel"
        );
      } else {
        console.warn(
          "[DiscordUserAccountService] Could not verify voice connection"
        );

        // Debug: Log available buttons to help diagnose
        const availableButtons = await this.discordPage.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll("button"));
          return buttons.slice(0, 10).map((btn) => ({
            text: btn.textContent?.trim() || "",
            ariaLabel: btn.getAttribute("aria-label") || "",
            className: btn.className || "",
            id: btn.id || "",
            visible: btn.offsetParent !== null,
          }));
        });
        console.log(
          "[DiscordUserAccountService] Available buttons on page:",
          JSON.stringify(availableButtons, null, 2)
        );

        console.warn(
          "[DiscordUserAccountService] Continuing anyway, may need manual join..."
        );
      }

      // Wait a bit more for voice connection to fully establish
      await delay(2000);

      // Start Go Live streaming
      // Look for "Go Live" or "Screen Share" button
      await this.startGoLive(contentPage);

      console.log(
        `[DiscordUserAccountService] Joined voice channel ${channelId} and started streaming`
      );
    } catch (error) {
      console.error(
        "[DiscordUserAccountService] Failed to join and stream:",
        error
      );
      throw error;
    }
  }

  /**
   * Start Go Live streaming with browser content
   */
  private async startGoLive(contentPage: Page): Promise<void> {
    if (!this.discordPage) {
      throw new Error("Discord page not available");
    }

    try {
      console.log("[DiscordUserAccountService] Looking for Go Live button...");

      // Take a screenshot before attempting to find the button
      await this.discordPage.screenshot({
        path: `/tmp/discord-before-golive-${Date.now()}.png`,
      });

      // Look for Go Live button in voice controls
      const buttonInfo = await this.discordPage.evaluate(() => {
        // Try to find Go Live button by various methods
        const allButtons = Array.from(document.querySelectorAll("button"));
        const buttonDetails: Array<{
          text: string;
          ariaLabel: string;
          className: string;
          disabled: boolean;
        }> = [];

        // Log all buttons for debugging
        for (const btn of allButtons.slice(0, 30)) {
          const label = btn.getAttribute("aria-label") || "";
          const text = btn.textContent || "";
          const className = btn.className || "";

          buttonDetails.push({
            text: text.trim().substring(0, 50),
            ariaLabel: label.substring(0, 100),
            className: className.substring(0, 100),
            disabled: btn.disabled,
          });
        }

        // First, try to find by aria-label - exact match for "Share Your Screen"
        let goLiveButton = allButtons.find((btn) => {
          const label = btn.getAttribute("aria-label") || "";
          return label === "Share Your Screen";
        });

        // Try case-insensitive variations
        if (!goLiveButton) {
          goLiveButton = allButtons.find((btn) => {
            const label = btn.getAttribute("aria-label")?.toLowerCase() || "";
            return (
              label === "share your screen" ||
              label.includes("go live") ||
              label.includes("screen share") ||
              label.includes("stream")
            );
          });
        }

        // If not found, try by text content
        if (!goLiveButton) {
          goLiveButton = allButtons.find((btn) => {
            const text = btn.textContent?.toLowerCase() || "";
            return (
              text.includes("go live") ||
              text.includes("share") ||
              text.includes("screen") ||
              text.includes("stream")
            );
          });
        }

        // If still not found, look for SVG icons that might indicate screen share
        if (!goLiveButton) {
          goLiveButton = allButtons.find((btn) => {
            const svg = btn.querySelector("svg");
            if (!svg) return false;
            const viewBox = svg.getAttribute("viewBox") || "";
            const paths = svg.querySelectorAll("path");
            // Discord's screen share icon often has specific path patterns
            return paths.length > 0;
          });
        }

        return {
          found: !!goLiveButton,
          clicked:
            goLiveButton && !goLiveButton.disabled
              ? (goLiveButton.click(), true)
              : false,
          disabled: goLiveButton?.disabled || false,
          buttonDetails,
        };
      });

      console.log("[DiscordUserAccountService] Button search results:", {
        found: buttonInfo.found,
        clicked: buttonInfo.clicked,
        disabled: buttonInfo.disabled,
        totalButtons: buttonInfo.buttonDetails.length,
      });

      // Log first few buttons for debugging
      if (!buttonInfo.clicked) {
        console.log("[DiscordUserAccountService] Available buttons:");
        for (const btn of buttonInfo.buttonDetails.slice(0, 10)) {
          console.log(
            `  - Text: "${btn.text}", Label: "${btn.ariaLabel}", Disabled: ${btn.disabled}`
          );
        }
      }

      if (!buttonInfo.clicked) {
        // Take screenshot showing the failure state
        await this.discordPage.screenshot({
          path: `/tmp/discord-golive-notfound-${Date.now()}.png`,
        });

        console.warn(
          "[DiscordUserAccountService] Could not find or click Go Live button automatically"
        );
        throw new Error(
          "Could not find Go Live button. Please ensure you're in a voice channel and have permission to stream."
        );
      }

      console.log("[DiscordUserAccountService] ✓ Go Live button clicked");

      // IMMEDIATELY try to select browser tab option before system modal appears
      // Don't wait - we need to catch Discord's modal immediately
      await delay(100); // Minimal delay
      console.log(
        "[DiscordUserAccountService] Immediately selecting browser tab option..."
      );

      // First, try to close any system modal that might have appeared
      const systemModalClosed = await this.discordPage.evaluate(() => {
        // Look for system modal indicators (GTK picker, etc.)
        // These usually have specific window titles or elements
        const bodyText = document.body.textContent || "";
        const hasSystemModal =
          bodyText.includes("Screen 0") ||
          bodyText.includes("DP-1") ||
          bodyText.includes("Allow a restore token") ||
          document.querySelector('[role="dialog"]') !== null;

        if (hasSystemModal) {
          // Try to close it by pressing Escape
          document.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              keyCode: 27,
              bubbles: true,
              cancelable: true,
            })
          );
          return true;
        }
        return false;
      });

      if (systemModalClosed) {
        console.log(
          "[DiscordUserAccountService] Closed system modal, waiting for Discord modal..."
        );
        await delay(300);
      }

      // Take screenshot right after clicking
      await this.discordPage.screenshot({
        path: `/tmp/discord-immediately-after-click-${Date.now()}.png`,
      });

      // Check for "Microphone Access is Denied" modal
      const hasMicPermissionModal = await this.discordPage.evaluate(() => {
        const text = document.body.textContent || "";
        return (
          text.includes("Microphone Access is Denied") ||
          text.includes("microphone can be found in the Discord Help")
        );
      });

      if (hasMicPermissionModal) {
        console.log(
          "[DiscordUserAccountService] ⚠️  Microphone permission modal detected - closing it"
        );

        // Close the modal by clicking the X button
        await this.discordPage.evaluate(() => {
          const closeButtons = Array.from(
            document.querySelectorAll(
              'button[aria-label*="Close"], button[aria-label*="close"], svg[aria-label*="Close"]'
            )
          );
          for (const btn of closeButtons) {
            const parent = btn.closest("button");
            if (parent) {
              (parent as HTMLElement).click();
              console.log("Clicked close button on permissions modal");
              return true;
            }
          }
          return false;
        });

        await delay(500);
        console.log(
          "[DiscordUserAccountService] ❌ Cannot start Go Live without microphone permissions"
        );
        console.log(
          "[DiscordUserAccountService] Please grant microphone access to Discord in Chrome settings:"
        );
        console.log(
          "[DiscordUserAccountService] chrome://settings/content/microphone"
        );

        // Take screenshot after closing
        await this.discordPage.screenshot({
          path: `/tmp/discord-after-mic-modal-close-${Date.now()}.png`,
        });

        throw new Error(
          "Microphone access denied - cannot start Go Live stream. Grant microphone permissions in Chrome settings."
        );
      }

      // Try to select the stream source IMMEDIATELY
      // The modal may close if we wait too long
      try {
        await this.selectStreamSource(contentPage);
      } catch (error) {
        console.warn(
          "[DiscordUserAccountService] Could not auto-select stream source:",
          error
        );
      }

      // Try to confirm if there's a confirmation button
      await delay(500);
      try {
        await this.confirmGoLive();
      } catch (error) {
        console.warn(
          "[DiscordUserAccountService] No confirmation button found, stream may have started automatically"
        );
      }

      console.log("[DiscordUserAccountService] Go Live stream started");
    } catch (error) {
      console.error(
        "[DiscordUserAccountService] Failed to start Go Live:",
        error
      );
      throw error;
    }
  }

  /**
   * Select the browser tab/window as stream source
   */
  private async selectStreamSource(contentPage: Page): Promise<void> {
    if (!this.discordPage) {
      throw new Error("Discord page not available");
    }

    console.log(
      "[DiscordUserAccountService] Looking for stream source options..."
    );

    // Don't wait - we need to act immediately to prevent system modal
    // Check for and close system modal first
    await delay(50);

    const systemModalHandled = await this.discordPage.evaluate(() => {
      // Check if system modal is visible
      const bodyText = document.body.textContent || "";
      const hasSystemModal =
        bodyText.includes("Screen 0") ||
        bodyText.includes("DP-1") ||
        bodyText.includes("Allow a restore token");

      if (hasSystemModal) {
        // Try multiple ways to close it
        // Method 1: Press Escape
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            keyCode: 27,
            bubbles: true,
            cancelable: true,
          })
        );

        // Method 2: Look for close buttons
        const closeButtons = document.querySelectorAll(
          'button, [role="button"]'
        );
        for (const btn of Array.from(closeButtons)) {
          const text = (btn.textContent || "").toLowerCase();
          const ariaLabel = (
            btn.getAttribute("aria-label") || ""
          ).toLowerCase();
          if (
            text.includes("cancel") ||
            text.includes("close") ||
            ariaLabel.includes("cancel") ||
            ariaLabel.includes("close")
          ) {
            (btn as HTMLElement).click();
            break;
          }
        }

        return true;
      }
      return false;
    });

    if (systemModalHandled) {
      console.log(
        "[DiscordUserAccountService] System modal detected and closed"
      );
      await delay(200);
    }

    // Take immediate screenshot to see if modal is present
    await this.discordPage.screenshot({
      path: `/tmp/discord-source-selection-${Date.now()}.png`,
    });

    // Step 1: IMMEDIATELY ensure we're on the "Browser Tab" or "Chromium Tab" option (not Screen/Window)
    console.log(
      "[DiscordUserAccountService] Step 1: Selecting 'Browser Tab' option..."
    );
    const tabOptionSelected = await this.discordPage.evaluate(() => {
      // First, check if we're in a system modal (GTK picker) - if so, close it
      const bodyText = document.body.textContent || "";
      if (
        bodyText.includes("Screen 0") ||
        bodyText.includes("DP-1") ||
        bodyText.includes("Allow a restore token")
      ) {
        console.log("System modal detected, closing...");
        // Press Escape to close
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            keyCode: 27,
            bubbles: true,
            cancelable: true,
          })
        );
        return false; // Will retry after modal closes
      }

      // Look for tab/source type buttons (usually at the top of the modal)
      // Also look for tabs/segments that might be in Discord's modal
      const allButtons = Array.from(
        document.querySelectorAll(
          'button, div[role="tab"], div[role="button"], [role="tablist"] button, [class*="tab"] button, [class*="segment"] button'
        )
      );

      // Try to find "Browser Tab", "Chromium Tab", "Tab" option
      // Priority: Look for exact matches first
      let tabButton = allButtons.find((btn) => {
        const text = (btn.textContent || "").toLowerCase();
        const ariaLabel = (btn.getAttribute("aria-label") || "").toLowerCase();
        const id = (btn.id || "").toLowerCase();

        return (
          text === "browser tab" ||
          text === "chromium tab" ||
          text === "tab" ||
          ariaLabel === "browser tab" ||
          ariaLabel === "chromium tab" ||
          ariaLabel === "tab"
        );
      });

      // If not found, try partial matches (but exclude Screen/Window)
      if (!tabButton) {
        tabButton = allButtons.find((btn) => {
          const text = (btn.textContent || "").toLowerCase();
          const ariaLabel = (
            btn.getAttribute("aria-label") || ""
          ).toLowerCase();
          const id = (btn.id || "").toLowerCase();

          return (
            (text.includes("browser tab") ||
              text.includes("chromium tab") ||
              (text.includes("tab") &&
                !text.includes("screen") &&
                !text.includes("window")) ||
              ariaLabel.includes("browser tab") ||
              ariaLabel.includes("chromium tab") ||
              (ariaLabel.includes("tab") &&
                !ariaLabel.includes("screen") &&
                !ariaLabel.includes("window")) ||
              (id.includes("tab") &&
                !id.includes("screen") &&
                !id.includes("window"))) &&
            !text.includes("screen") &&
            !text.includes("window") &&
            !ariaLabel.includes("screen") &&
            !ariaLabel.includes("window")
          );
        });
      }

      if (tabButton) {
        // Check if already selected
        const isSelected =
          tabButton.classList.contains("selected") ||
          tabButton.getAttribute("aria-selected") === "true" ||
          tabButton.getAttribute("data-selected") === "true";

        if (!isSelected) {
          console.log(
            "Clicking tab option button:",
            tabButton.textContent || tabButton.getAttribute("aria-label")
          );
          (tabButton as HTMLElement).click();
          return true;
        } else {
          console.log("Tab option already selected");
          return true;
        }
      }

      // Alternative: Look for tabs/segments in the modal header
      const tabElements = Array.from(
        document.querySelectorAll(
          '[role="tablist"] button, [class*="tab"] button, [class*="segment"] button'
        )
      );
      for (const btn of tabElements) {
        const text = (btn.textContent || "").toLowerCase();
        if (
          text.includes("tab") &&
          !text.includes("screen") &&
          !text.includes("window")
        ) {
          const isSelected =
            btn.classList.contains("selected") ||
            btn.getAttribute("aria-selected") === "true";
          if (!isSelected) {
            console.log("Clicking tab segment:", btn.textContent);
            (btn as HTMLElement).click();
            return true;
          }
          return true;
        }
      }

      console.warn("Could not find 'Browser Tab' option button");
      return false;
    });

    if (tabOptionSelected) {
      console.log(
        "[DiscordUserAccountService] ✓ Selected 'Browser Tab' option"
      );
      // Wait for tab list to load
      await delay(1000);
    } else {
      console.warn(
        "[DiscordUserAccountService] Could not find 'Browser Tab' option on first try"
      );

      // Check if system modal is still open
      const stillHasSystemModal = await this.discordPage.evaluate(() => {
        const bodyText = document.body.textContent || "";
        return (
          bodyText.includes("Screen 0") ||
          bodyText.includes("DP-1") ||
          bodyText.includes("Allow a restore token")
        );
      });

      if (stillHasSystemModal) {
        console.log(
          "[DiscordUserAccountService] System modal still open, closing and retrying..."
        );
        // Close it more aggressively
        await this.discordPage.keyboard.press("Escape");
        await delay(500);
        await this.discordPage.keyboard.press("Escape");
        await delay(500);

        // Try clicking "Share Your Screen" again, but this time look for browser tab option first
        // Actually, let's just wait a bit and check for Discord's modal
        await delay(1000);

        // Retry finding browser tab option
        const retryResult = await this.discordPage.evaluate(() => {
          const allButtons = Array.from(
            document.querySelectorAll(
              'button, div[role="tab"], div[role="button"], [role="tablist"] button'
            )
          );

          const tabButton = allButtons.find((btn) => {
            const text = (btn.textContent || "").toLowerCase();
            const ariaLabel = (
              btn.getAttribute("aria-label") || ""
            ).toLowerCase();
            return (
              (text.includes("browser tab") ||
                text.includes("chromium tab") ||
                (text.includes("tab") &&
                  !text.includes("screen") &&
                  !text.includes("window"))) &&
              !text.includes("screen") &&
              !text.includes("window")
            );
          });

          if (tabButton) {
            (tabButton as HTMLElement).click();
            return true;
          }
          return false;
        });

        if (retryResult) {
          console.log(
            "[DiscordUserAccountService] ✓ Selected 'Browser Tab' option on retry"
          );
          await delay(1000);
        } else {
          console.warn(
            "[DiscordUserAccountService] Could not find 'Browser Tab' option after retry, continuing anyway..."
          );
        }
      } else {
        console.warn(
          "[DiscordUserAccountService] Could not find 'Browser Tab' option, continuing anyway..."
        );
      }
    }

    // Step 2: Get the content page title and URL to match against
    const contentPageTitle = await contentPage.title();
    const contentPageUrl = await contentPage.url();
    console.log(
      "[DiscordUserAccountService] Looking for tab with title:",
      contentPageTitle
    );
    console.log(
      "[DiscordUserAccountService] Looking for tab with URL:",
      contentPageUrl
    );

    // Step 3: Find and click the matching tab in the list
    console.log(
      "[DiscordUserAccountService] Step 2: Finding matching tab in browser tabs list..."
    );
    const tabSelected = await this.discordPage.evaluate(
      (targetTitle, targetUrl) => {
        // Look for all clickable elements that might represent browser tabs
        const allClickable = Array.from(
          document.querySelectorAll(
            'div[class*="card"], div[class*="source"], div[class*="tab"], div[class*="preview"], ' +
              'div[class*="item"], button[class*="card"], button[class*="source"], ' +
              '[role="option"], [role="button"]'
          )
        );

        const tabDetails: Array<{
          text: string;
          url: string;
          element: HTMLElement;
        }> = [];

        // First pass: collect all potential tab elements with their info
        for (const el of allClickable) {
          const text = el.textContent || "";
          const title = el.getAttribute("title") || "";
          const ariaLabel = el.getAttribute("aria-label") || "";

          // Look for YouTube-related text or URLs
          const fullText = (text + " " + title + " " + ariaLabel).toLowerCase();

          if (
            fullText.includes("youtube") ||
            fullText.includes("charlie") ||
            fullText.includes("unicorn") ||
            fullText.includes("you") ||
            text.trim().length > 0
          ) {
            // Try to extract URL from data attributes or text
            let url = "";
            const dataUrl =
              el.getAttribute("data-url") || el.getAttribute("data-href") || "";
            if (dataUrl) {
              url = dataUrl;
            } else if (text.includes("http") || text.includes("youtube.com")) {
              url = text;
            }

            tabDetails.push({
              text: text.substring(0, 100),
              url: url.substring(0, 200),
              element: el as HTMLElement,
            });
          }
        }

        // Log available tabs for debugging
        console.log(`Found ${tabDetails.length} potential tab elements`);
        for (const tab of tabDetails.slice(0, 10)) {
          console.log(
            `  - "${tab.text.substring(0, 50)}" (URL: ${tab.url.substring(
              0,
              50
            )})`
          );
        }

        // Try to find the matching tab
        // Priority 1: Exact title match (e.g., "Charlie the Unicorn - YouTube")
        let selectedTab = tabDetails.find((tab) => {
          const tabTextLower = tab.text.toLowerCase();
          const targetTitleLower = targetTitle.toLowerCase();
          // Check if tab text contains the full title or key parts of it
          return (
            tabTextLower === targetTitleLower ||
            tabTextLower.includes(targetTitleLower) ||
            targetTitleLower.includes(tabTextLower) ||
            // Also check for key words from the title
            targetTitleLower
              .split(" ")
              .some((word) => word.length > 3 && tabTextLower.includes(word))
          );
        });

        // Priority 2: Exact URL match (especially for about:blank)
        if (!selectedTab && targetUrl) {
          // Special handling for about:blank - look for empty/minimal titles
          if (targetUrl === "about:blank" || targetUrl.startsWith("about:")) {
            selectedTab = tabDetails.find((tab) => {
              // Look for tabs with minimal or empty text (likely about:blank)
              const textLower = tab.text.toLowerCase().trim();
              // Exclude Discord tabs (they usually have server/channel names)
              const isDiscordTab = 
                textLower.includes("discord") ||
                textLower.includes("arcados") ||
                textLower.includes("guild") ||
                textLower.includes("channel");
              
              // Prefer tabs with very short or empty text, but not Discord
              return !isDiscordTab && (textLower.length === 0 || textLower.length < 10);
            });
            
            // If still not found, look for tabs that don't match common Discord patterns
            if (!selectedTab) {
              selectedTab = tabDetails.find((tab) => {
                const textLower = tab.text.toLowerCase().trim();
                return !textLower.includes("discord") && 
                       !textLower.includes("arcados") &&
                       !textLower.includes("guild") &&
                       !textLower.includes("channel") &&
                       !textLower.includes("voice");
              });
            }
          } else {
            // For other URLs, try exact match
            selectedTab = tabDetails.find(
              (tab) =>
                tab.url &&
                (tab.url === targetUrl ||
                  tab.url.includes(new URL(targetUrl).hostname) ||
                  targetUrl.includes(tab.url))
            );
          }
        }

        // Priority 3: Text contains "YouTube" or key words from title (only if not about:blank)
        if (!selectedTab && targetUrl !== "about:blank" && !targetUrl.startsWith("about:")) {
          const titleWords = targetTitle
            .toLowerCase()
            .split(" ")
            .filter((w) => w.length > 3);
          selectedTab = tabDetails.find((tab) => {
            const tabTextLower = tab.text.toLowerCase();
            return (
              tabTextLower.includes("youtube") ||
              titleWords.some((word) => tabTextLower.includes(word))
            );
          });
        }

        // Priority 4: Text contains "You" (might be truncated "YouTube") - skip for about:blank
        if (!selectedTab && targetUrl !== "about:blank" && !targetUrl.startsWith("about:")) {
          selectedTab = tabDetails.find(
            (tab) =>
              tab.text.toLowerCase().includes("you") && tab.text.length > 3
          );
        }

        // Priority 5: First non-empty tab that's not Discord (only as last resort)
        if (!selectedTab && tabDetails.length > 0) {
          selectedTab = tabDetails.find((tab) => {
            const textLower = tab.text.toLowerCase().trim();
            // Exclude Discord-related tabs
            return textLower.length > 0 && 
                   !textLower.includes("discord") &&
                   !textLower.includes("arcados");
          });
        }

        if (selectedTab) {
          console.log(`Clicking tab: "${selectedTab.text.substring(0, 50)}"`);
          selectedTab.element.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
          selectedTab.element.click();
          return {
            clicked: true,
            selectedText: selectedTab.text.substring(0, 100),
            totalTabs: tabDetails.length,
          };
        }

        return {
          clicked: false,
          selectedText: "",
          totalTabs: tabDetails.length,
          availableTabs: tabDetails
            .slice(0, 5)
            .map((t) => t.text.substring(0, 50)),
        };
      },
      contentPageTitle,
      contentPageUrl
    );

    console.log("[DiscordUserAccountService] Tab selection result:", {
      clicked: tabSelected.clicked,
      selectedText: tabSelected.selectedText,
      totalTabs: tabSelected.totalTabs,
      availableTabs: (tabSelected as any).availableTabs,
    });

    if (tabSelected.clicked) {
      console.log(
        "[DiscordUserAccountService] ✓ Selected YouTube tab:",
        tabSelected.selectedText
      );
      // Wait for selection to register
      await delay(500);
    } else {
      console.warn(
        "[DiscordUserAccountService] Could not find YouTube tab in list"
      );
      if ((tabSelected as any).availableTabs) {
        console.log(
          "[DiscordUserAccountService] Available tabs:",
          (tabSelected as any).availableTabs
        );
      }
      // Take a screenshot to debug
      await this.discordPage.screenshot({
        path: `/tmp/discord-tab-not-found-${Date.now()}.png`,
      });
    }

    // Step 4: Look for and click "Go Live" or "Share" button to confirm
    console.log(
      "[DiscordUserAccountService] Step 3: Confirming stream source selection..."
    );
    await delay(500);

    const confirmed = await this.discordPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));

      // Look for "Go Live", "Share", "Start Streaming" button
      const confirmButton = buttons.find((btn) => {
        const text = (btn.textContent || "").toLowerCase();
        const ariaLabel = (btn.getAttribute("aria-label") || "").toLowerCase();

        return (
          (text.includes("go live") ||
            text.includes("share") ||
            text.includes("start streaming") ||
            text.includes("stream") ||
            ariaLabel.includes("go live") ||
            ariaLabel.includes("share") ||
            ariaLabel.includes("start streaming")) &&
          !btn.disabled
        );
      });

      if (confirmButton) {
        console.log(
          "Clicking confirm button:",
          confirmButton.textContent || confirmButton.getAttribute("aria-label")
        );
        (confirmButton as HTMLElement).click();
        return true;
      }

      return false;
    });

    if (confirmed) {
      console.log(
        "[DiscordUserAccountService] ✓ Confirmed stream source selection"
      );
      await delay(1000);
    } else {
      console.log(
        "[DiscordUserAccountService] No confirmation button found, stream may start automatically"
      );
    }
  }

  /**
   * Confirm and start Go Live
   */
  private async confirmGoLive(): Promise<void> {
    if (!this.discordPage) {
      throw new Error("Discord page not available");
    }

    // Click the final "Go Live" or "Share" button in the modal
    const confirmed = await this.discordPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));

      // Look for confirm/start button
      const confirmButton = buttons.find((btn) => {
        const text = btn.textContent?.toLowerCase() || "";
        const label = btn.getAttribute("aria-label")?.toLowerCase() || "";
        return (
          (text.includes("go live") ||
            text.includes("share") ||
            text.includes("start") ||
            label.includes("go live") ||
            label.includes("share")) &&
          !btn.disabled
        );
      });

      if (confirmButton) {
        (confirmButton as HTMLElement).click();
        return true;
      }

      return false;
    });

    if (!confirmed) {
      console.warn(
        "[DiscordUserAccountService] Could not find confirm button, stream may need manual confirmation"
      );
    }

    await delay(3000); // Wait for stream to start
  }

  /**
   * Stop streaming and leave voice channel
   */
  async stopStreaming(guildId: string): Promise<void> {
    if (!this.discordPage) {
      return;
    }

    try {
      // Look for "Stop Streaming" or "Disconnect" button
      await this.discordPage.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button"));
        const stopButton = buttons.find(
          (btn) =>
            btn.textContent?.toLowerCase().includes("stop") ||
            btn.textContent?.toLowerCase().includes("disconnect") ||
            btn.textContent?.toLowerCase().includes("leave")
        );
        if (stopButton) {
          (stopButton as HTMLElement).click();
        }
      });

      await delay(2000);

      console.log("[DiscordUserAccountService] Stopped streaming");
    } catch (error) {
      console.error(
        "[DiscordUserAccountService] Error stopping stream:",
        error
      );
    }
  }

  /**
   * Sign out of Discord
   */
  async signOut(): Promise<void> {
    if (!this.discordPage || !this.isLoggedIn) {
      return;
    }

    try {
      // Open user settings menu
      await this.discordPage.evaluate(() => {
        // Click user avatar/menu
        const userMenu = document.querySelector(
          '[class*="avatar"], [class*="user"]'
        );
        if (userMenu) {
          (userMenu as HTMLElement).click();
        }
      });

      await delay(1000);

      // Click logout
      await this.discordPage.evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll('button, [role*="button"]')
        );
        const logoutButton = buttons.find(
          (btn) =>
            btn.textContent?.toLowerCase().includes("log out") ||
            btn.textContent?.toLowerCase().includes("sign out")
        );
        if (logoutButton) {
          (logoutButton as HTMLElement).click();
        }
      });

      await delay(2000);

      this.isLoggedIn = false;
      console.log("[DiscordUserAccountService] Signed out of Discord");
    } catch (error) {
      console.error("[DiscordUserAccountService] Error signing out:", error);
    }
  }

  /**
   * Cleanup: close Discord page and sign out
   */
  async cleanup(): Promise<void> {
    try {
      await this.stopStreaming("");
      await this.signOut();

      if (this.discordPage) {
        await this.discordPage.close();
        this.discordPage = null;
      }

      this.isLoggedIn = false;
    } catch (error) {
      console.error("[DiscordUserAccountService] Error during cleanup:", error);
    }
  }

  /**
   * Check if currently logged in
   */
  isSignedIn(): boolean {
    return this.isLoggedIn;
  }
}
