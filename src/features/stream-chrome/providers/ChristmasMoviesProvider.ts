import { BaseProvider } from "./BaseProvider.js";
import type { Page } from "puppeteer";
import type { SearchResult } from "../types.js";
import { STREAM_CONSTANTS } from "../constants.js";
import { config } from "../../../config/index.js";

/**
 * Provider for Christmas movies from Jellyfin collection.
 *
 * Opens the Christmas collection on Jellyfin and plays it shuffled.
 *
 * Typical usage:
 *   - Provider key: "christmas-movies"
 *   - Query: Any query will open the Jellyfin Christmas collection and play it shuffled
 */
export class ChristmasMoviesProvider extends BaseProvider {
  private jellyfinUrl: string;
  private readonly CHRISTMAS_COLLECTION_URL =
    "http://localhost:8096/web/#/details?id=0008841a5f5bffde0aefbc67ecb943cf&serverId=42d25b50599f4e54a351ddd9a0219af1";

  constructor() {
    // Use Jellyfin URL from config, or default to localhost
    const jellyfinBaseUrl = config.jellyfinServerUrl || "http://localhost:8096";
    super("christmas-movies", jellyfinBaseUrl, ["movie", "tv"]);
    this.jellyfinUrl = jellyfinBaseUrl;
    // Christmas movies provider supports all playback controls except nextEpisode
    this.capabilities = {
      pause: true,
      resume: true,
      seek: true,
      skip: true,
      restart: true,
      nextEpisode: false,
    };
  }

  /**
   * Search for Christmas content - returns a single result that opens the Jellyfin Christmas collection.
   * Note: This doesn't actually search, just returns a result to play the collection shuffled.
   */
  async searchContent(query: string, page: Page): Promise<SearchResult[]> {
    try {
      // Return a single search result that represents the Christmas collection
      return [
        {
          title: "Christmas Collection (Shuffled)",
          type: "movie" as const,
          url: this.CHRISTMAS_COLLECTION_URL,
          description: "Play Christmas collection shuffled",
        },
      ];
    } catch (error) {
      console.error(
        `[ChristmasMoviesProvider] Search failed for query "${query}":`,
        error
      );
      throw error;
    }
  }

  async navigateToContent(result: SearchResult, page: Page): Promise<Page> {
    try {
      console.log(
        `[ChristmasMoviesProvider] Navigating to Jellyfin Christmas collection: ${result.url}`
      );

      await page.goto(result.url, {
        waitUntil: "networkidle2",
        timeout: STREAM_CONSTANTS.NAVIGATION_TIMEOUT,
      });

      // Wait for Jellyfin web app to load
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Close any popups/modals
      await this.closePopups(page);

      // Wait for collection page to fully load
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Now find and click the shuffle button to start playing shuffled
      console.log(
        "[ChristmasMoviesProvider] Looking for shuffle button to start playing..."
      );
      await this.clickShuffleButton(page);

      return page;
    } catch (error) {
      console.error(
        `[ChristmasMoviesProvider] Failed to navigate to ${result.url}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Find and click the shuffle button in Jellyfin UI
   */
  private async clickShuffleButton(page: Page): Promise<void> {
    try {
      const shuffleClicked = await page.evaluate(() => {
        // Jellyfin shuffle button - exact selector from user
        const shuffleSelector = "span.material-icons.detailButton-icon.shuffle";

        try {
          const shuffleElement = document.querySelector(shuffleSelector) as HTMLElement;
          if (shuffleElement && shuffleElement.offsetParent !== null) {
            // Click the parent button if it exists, otherwise click the span
            const parentButton = shuffleElement.closest("button");
            if (parentButton) {
              (parentButton as HTMLElement).click();
              console.log("Clicked shuffle button (parent of span)");
            } else {
              shuffleElement.click();
              console.log("Clicked shuffle span directly");
            }
            return true;
          }
        } catch (error) {
          console.error("Error clicking shuffle button:", error);
        }

        // Fallback: look for button containing the shuffle span
        const buttons = document.querySelectorAll("button");
        for (const button of Array.from(buttons)) {
          const shuffleSpan = button.querySelector(shuffleSelector);
          if (shuffleSpan && (button as HTMLElement).offsetParent !== null) {
            (button as HTMLElement).click();
            console.log("Clicked button containing shuffle span");
            return true;
          }
        }

        return false;
      });

      if (shuffleClicked) {
        console.log(
          "[ChristmasMoviesProvider] ✓ Successfully clicked shuffle button"
        );

        // Wait for any navigation that might happen after clicking shuffle
        console.log(
          "[ChristmasMoviesProvider] Waiting for navigation after shuffle click..."
        );
        try {
          await page.waitForNavigation({
            waitUntil: "networkidle2",
            timeout: 5000,
          }).catch(() => {
            // Navigation might not happen, that's okay
            console.log("[ChristmasMoviesProvider] No navigation detected after shuffle");
          });
        } catch (error) {
          // Navigation timeout is fine, continue
          console.log("[ChristmasMoviesProvider] Navigation wait completed or timed out");
        }

        // Wait longer for Jellyfin to start playback and handle any transcoding
        console.log(
          "[ChristmasMoviesProvider] Waiting for playback to start..."
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Check if page is still valid before using it
        if (page.isClosed()) {
          console.warn(
            "[ChristmasMoviesProvider] Page was closed after shuffle, cannot dismiss error dialog"
          );
          return;
        }

        // Check for and dismiss error dialog if it appears
        await this.dismissErrorDialog(page);
      } else {
        console.warn(
          "[ChristmasMoviesProvider] ⚠ Could not find shuffle button - collection may need manual interaction"
        );
      }
    } catch (error) {
      console.error(
        "[ChristmasMoviesProvider] Error clicking shuffle button:",
        error
      );
    }
  }

  async waitForPlayer(page: Page): Promise<void> {
    try {
      console.log(
        "[ChristmasMoviesProvider] Waiting for Jellyfin player to appear..."
      );

      // Wait for Jellyfin web app to load
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Wait for video element or Jellyfin player container
      const videoSelectors = [
        "video",
        "[class*='videoPlayer']",
        "[class*='player']",
        "[id*='player']",
        "iframe[src*='player']",
      ];

      let videoFound = false;
      for (const selector of videoSelectors) {
        try {
          await page.waitForSelector(selector, {
            timeout: STREAM_CONSTANTS.PLAYER_DETECTION_TIMEOUT,
          });
          console.log(
            `[ChristmasMoviesProvider] Found video element with selector: ${selector}`
          );
          videoFound = true;
          break;
        } catch {
          // Try next selector
        }
      }

      if (!videoFound) {
        console.warn(
          "[ChristmasMoviesProvider] Video player element not found with standard selectors (Jellyfin collection page may be open - user can select content manually)"
        );
      }

      // Wait for video to actually start playing (not just appear)
      console.log(
        "[ChristmasMoviesProvider] Waiting for video to start playing..."
      );
      let attempts = 0;
      const maxAttempts = 10;
      while (attempts < maxAttempts) {
        const isPlaying = await page.evaluate(() => {
          const video = document.querySelector("video") as HTMLVideoElement;
          if (video) {
            return !video.paused && video.readyState >= 2 && video.currentTime > 0;
          }
          return false;
        });

        if (isPlaying) {
          console.log(
            "[ChristmasMoviesProvider] ✓ Video is playing!"
          );
          break;
        }

        attempts++;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // Wait a bit more for any dynamic content to load
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      console.error(
        "[ChristmasMoviesProvider] Failed to wait for player:",
        error
      );
      // Don't throw - continue anyway, clickPlay will try to find and play video
    }
  }

  /**
   * Dismiss error dialog if it appears (e.g., playback errors)
   */
  private async dismissErrorDialog(page: Page): Promise<void> {
    try {
      // Check if page is still valid
      if (page.isClosed()) {
        console.warn(
          "[ChristmasMoviesProvider] Page is closed, cannot dismiss error dialog"
        );
        return;
      }

      const dialogDismissed = await page.evaluate(() => {
        // Look for error dialog with "Got It" button
        const gotItButton = Array.from(document.querySelectorAll("button")).find(
          (btn) => {
            const text = btn.textContent?.toLowerCase() || "";
            return text.includes("got it") || text.includes("ok") || text.includes("dismiss");
          }
        ) as HTMLElement | undefined;

        if (gotItButton && gotItButton.offsetParent !== null) {
          gotItButton.click();
          console.log("Dismissed error dialog");
          return true;
        }

        // Also try to find by aria-label or class
        const errorDialogButtons = document.querySelectorAll(
          'button[aria-label*="got it" i], button[aria-label*="ok" i], button[aria-label*="dismiss" i]'
        );
        for (const btn of Array.from(errorDialogButtons)) {
          if ((btn as HTMLElement).offsetParent !== null) {
            (btn as HTMLElement).click();
            console.log("Dismissed error dialog by aria-label");
            return true;
          }
        }

        return false;
      });

      if (dialogDismissed) {
        console.log(
          "[ChristmasMoviesProvider] Dismissed error dialog, waiting a bit more..."
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.warn(
        "[ChristmasMoviesProvider] Error dismissing dialog:",
        error
      );
    }
  }

  async clickPlay(page: Page): Promise<void> {
    try {
      // Check if page is still valid
      if (page.isClosed()) {
        console.warn(
          "[ChristmasMoviesProvider] Page is closed, cannot check playback status"
        );
        return;
      }

      console.log(
        "[ChristmasMoviesProvider] Note: Shuffle already started playback, skipping play click"
      );

      // Shuffle button already starts playback, so we don't need to click play
      // Just wait a bit and check if video is playing
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Check if page is still valid before evaluating
      if (page.isClosed()) {
        console.warn(
          "[ChristmasMoviesProvider] Page closed while waiting, cannot check playback"
        );
        return;
      }

      // Check if video is already playing
      const isPlaying = await page.evaluate(() => {
        const video = document.querySelector("video") as HTMLVideoElement;
        if (video) {
          return !video.paused && video.readyState >= 2;
        }
        return false;
      }).catch((error) => {
        console.warn(
          "[ChristmasMoviesProvider] Error checking playback status:",
          error
        );
        return false;
      });

      if (isPlaying) {
        console.log(
          "[ChristmasMoviesProvider] ✓ Video is already playing from shuffle"
        );
      } else {
        console.log(
          "[ChristmasMoviesProvider] Video not playing yet, waiting a bit more..."
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      const playResult = await page.evaluate(() => {
        const video = document.querySelector("video") as HTMLVideoElement;

        if (video) {
          video.click();
          video.play().catch(() => {
            video.click();
          });

          return {
            success: true,
            method: "video-click",
            isPlaying: !video.paused,
          };
        }

        const playSelectors = [
          "button[aria-label*='play' i]",
          ".play-button",
          "[class*='play'][class*='button']",
          "[id*='play']",
          "button:has-text('Play')",
        ];

        for (const selector of playSelectors) {
          try {
            const element = document.querySelector(selector) as HTMLElement;
            if (element && element.offsetParent !== null) {
              element.click();
              return {
                success: true,
                method: `button-${selector}`,
                isPlaying: false,
              };
            }
          } catch {
            // Continue
          }
        }

        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;
        const elementAtCenter = document.elementFromPoint(centerX, centerY);
        if (elementAtCenter) {
          (elementAtCenter as HTMLElement).click();
          return { success: true, method: "center-click", isPlaying: false };
        }

        return { success: false, method: "none", isPlaying: false };
      });

      console.log(
        `[ChristmasMoviesProvider] Play attempt result:`,
        playResult
      );

      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      console.error(
        "[ChristmasMoviesProvider] Failed to click play:",
        error
      );
    }
  }

  async enterFullscreen(page: Page): Promise<void> {
    try {
      // Check if page is still valid
      if (page.isClosed()) {
        console.warn(
          "[ChristmasMoviesProvider] Page is closed, cannot enter fullscreen"
        );
        return;
      }

      console.log(
        "[ChristmasMoviesProvider] Looking for Jellyfin fullscreen button..."
      );

      const fullscreenClicked = await page.evaluate(() => {
        // Jellyfin fullscreen button - exact selector from user
        const fullscreenSelector =
          "span.xlargePaperIconButton.material-icons.fullscreen";

        try {
          const fullscreenElement = document.querySelector(
            fullscreenSelector
          ) as HTMLElement;
          if (fullscreenElement && fullscreenElement.offsetParent !== null) {
            // Click the parent button if it exists, otherwise click the span
            const parentButton = fullscreenElement.closest("button");
            if (parentButton) {
              (parentButton as HTMLElement).click();
              console.log("Clicked fullscreen button (parent of span)");
            } else {
              fullscreenElement.click();
              console.log("Clicked fullscreen span directly");
            }
            return true;
          }
        } catch (error) {
          console.error("Error clicking fullscreen button:", error);
        }

        // Fallback: look for button containing the fullscreen span
        const buttons = document.querySelectorAll("button");
        for (const button of Array.from(buttons)) {
          const fullscreenSpan = button.querySelector(fullscreenSelector);
          if (
            fullscreenSpan &&
            (button as HTMLElement).offsetParent !== null
          ) {
            (button as HTMLElement).click();
            console.log("Clicked button containing fullscreen span");
            return true;
          }
        }

        // Fallback: try video element fullscreen API
        const video = document.querySelector("video") as HTMLVideoElement;
        if (video && video.requestFullscreen) {
          video.requestFullscreen().catch((err) => {
            console.warn("Failed to enter fullscreen via video API:", err);
          });
          return true;
        }

        return false;
      }).catch((error) => {
        console.warn(
          "[ChristmasMoviesProvider] Error evaluating fullscreen click:",
          error
        );
        return false;
      });

      if (fullscreenClicked) {
        console.log(
          "[ChristmasMoviesProvider] ✓ Successfully clicked fullscreen button"
        );
        // Wait a bit for fullscreen to activate
        await new Promise((resolve) => setTimeout(resolve, 200));
      } else {
        console.warn(
          "[ChristmasMoviesProvider] ⚠ Could not find fullscreen button"
        );
      }
    } catch (error) {
      // Check if it's a detached frame error
      if (error instanceof Error && error.message.includes("detached")) {
        console.warn(
          "[ChristmasMoviesProvider] Page was detached, cannot enter fullscreen. This is normal if Jellyfin navigated to a new page."
        );
      } else {
        console.warn(
          "[ChristmasMoviesProvider] Failed to enter fullscreen:",
          error
        );
      }
    }
  }

  async closePopups(page: Page): Promise<void> {
    try {
      // Check if page is still valid
      if (page.isClosed()) {
        console.warn(
          "[ChristmasMoviesProvider] Page is closed, cannot close popups"
        );
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 200));

      await page.evaluate(() => {
        const closeSelectors = [
          "button[aria-label*='close' i]",
          ".close",
          ".modal-close",
          "[class*='close']",
          "[class*='popup-close']",
          "[id*='close']",
          "[aria-label*='close' i]",
          "button:has-text('Close')",
          "button:has-text('×')",
          "button:has-text('X')",
          "[class*='dismiss']",
        ];

        for (const selector of closeSelectors) {
          try {
            const elements = document.querySelectorAll(selector);
            for (const element of Array.from(elements)) {
              const el = element as HTMLElement;
              if (el.offsetParent !== null) {
                el.click();
              }
            }
          } catch {
            // Continue
          }
        }

        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            keyCode: 27,
            bubbles: true,
          })
        );
        document.dispatchEvent(
          new KeyboardEvent("keyup", {
            key: "Escape",
            keyCode: 27,
            bubbles: true,
          })
        );
      });

      await page.keyboard.press("Escape").catch(() => {
        // Page might be detached, ignore keyboard errors
      });

      console.log("[ChristmasMoviesProvider] Popup closing attempt completed");
    } catch (error) {
      // Check if it's a detached frame error
      if (error instanceof Error && error.message.includes("detached")) {
        console.warn(
          "[ChristmasMoviesProvider] Page was detached while closing popups. This is normal if Jellyfin navigated."
        );
      } else {
        console.warn(
          "[ChristmasMoviesProvider] Error closing popups:",
          error
        );
      }
    }
  }

  async isContentEnded(page: Page): Promise<boolean> {
    try {
      return await page.evaluate(() => {
        const video = document.querySelector("video") as HTMLVideoElement;
        if (video) {
          return video.ended;
        }

        const audio = document.querySelector("audio") as HTMLAudioElement;
        if (audio) {
          return audio.ended;
        }

        return false;
      });
    } catch (error) {
      console.error(
        "[ChristmasMoviesProvider] Error checking if content ended:",
        error
      );
      return false;
    }
  }

  async getPlaybackPosition(page: Page): Promise<number> {
    try {
      return await page.evaluate(() => {
        const video = document.querySelector("video") as HTMLVideoElement;
        if (video && video.duration > 0) {
          return video.currentTime / video.duration;
        }

        const audio = document.querySelector("audio") as HTMLAudioElement;
        if (audio && audio.duration > 0) {
          return audio.currentTime / audio.duration;
        }

        return 0;
      });
    } catch (error) {
      console.error(
        "[ChristmasMoviesProvider] Error getting playback position:",
        error
      );
      return 0;
    }
  }
}


