import type { EmojiConfig } from "./EmbedController.js";

/**
 * Custom Emoji Configuration for Media Player Buttons
 * 
 * To use white/monochrome icons like Euphony bot:
 * 
 * STEP 1: Upload Custom Emojis to Your Discord Server
 * - Go to your Discord server settings > Emoji
 * - Upload white/monochrome PNG images (128x128px recommended)
 * - Name them appropriately (e.g., "play_icon", "pause_icon", etc.)
 * 
 * STEP 2: Get Emoji IDs
 * - Enable Developer Mode in Discord (User Settings > Advanced > Developer Mode)
 * - Right-click on the emoji in your server's emoji list
 * - Click "Copy ID" (or use the emoji picker and copy the emoji, then extract the ID)
 * - The ID is a long number like "1234567890123456789"
 * 
 * STEP 3: Configure the IDs Below
 * - Replace the empty strings with your emoji IDs
 * - Leave as empty string ("") to use Unicode emojis (colored)
 * 
 * Example emoji names you might want:
 * - queue_icon (📋)
 * - previous_icon (⏮️)
 * - back_icon (⏪)
 * - play_icon (▶️)
 * - pause_icon (⏸️)
 * - forward_icon (⏩)
 * - next_icon (⏭️)
 * - stop_icon (⏹️)
 * - shuffle_icon (🔀)
 * - loop_icon (🔁)
 * - volume_down_icon (🔉)
 * - volume_up_icon (🔊)
 */

export const emojiConfig: EmojiConfig = {
	// Queue button (📋)
	queue: "", // Replace with your emoji ID

	// Previous track button (⏮️)
	previous: "", // Replace with your emoji ID

	// Skip back 10s button (⏪)
	back: "", // Replace with your emoji ID

	// Play button (▶️)
	play: "", // Replace with your emoji ID

	// Pause button (⏸️)
	pause: "", // Replace with your emoji ID

	// Skip forward 10s button (⏩)
	forward: "", // Replace with your emoji ID

	// Next track button (⏭️)
	next: "", // Replace with your emoji ID

	// Stop button (⏹️)
	stop: "", // Replace with your emoji ID

	// Shuffle button (🔀)
	shuffle: "", // Replace with your emoji ID

	// Loop button (🔁)
	loop: "", // Replace with your emoji ID

	// Volume down button (🔉)
	volumeDown: "", // Replace with your emoji ID

	// Volume up button (🔊)
	volumeUp: "", // Replace with your emoji ID
};

/**
 * Helper function to check if any custom emojis are configured
 */
export function hasCustomEmojis(): boolean {
	return Object.values(emojiConfig).some((id) => id && id.length > 0);
}

