/**
 * Basic test script for stream architecture refactor
 * Tests core components without requiring Discord or Puppeteer
 */

import { ProviderRegistry } from "./registry/ProviderRegistry.js";
import { ProviderRouter } from "./routing/ProviderRouter.js";
import { ContentSelector } from "./selection/ContentSelector.js";
import { NumericStrategy } from "./selection/strategies/NumericStrategy.js";
import { parseTimeString } from "./utils/timeParser.js";
import { formatDuration } from "./utils/formatters.js";
import type { SearchResult } from "./types.js";

// Mock search results for testing
const mockSearchResults: SearchResult[] = [
	{
		title: "The Simpsons Season 1 Episode 3",
		type: "tv",
		url: "https://example.com/simpsons-s01e03",
		description: "Homer and Marge go on a date",
		season: 1,
		episode: 3,
	},
	{
		title: "The Simpsons Season 2 Episode 1",
		type: "tv",
		url: "https://example.com/simpsons-s02e01",
		description: "Bart gets a dog",
		season: 2,
		episode: 1,
	},
	{
		title: "Futurama Pilot",
		type: "tv",
		url: "https://example.com/futurama-pilot",
		description: "Fry wakes up in the future",
	},
];

console.log("🧪 Testing Stream Architecture Components\n");

// Test 1: Provider Registry
console.log("1. Testing ProviderRegistry...");
const registry = ProviderRegistry.getInstance();
const youtubeProvider = registry.getProvider("youtube");
const jellyfinProvider = registry.getProvider("jellyfin");
console.log(`   ✓ YouTube provider: ${youtubeProvider ? "found" : "not found"}`);
console.log(`   ✓ Jellyfin provider: ${jellyfinProvider ? "found" : "not found"}`);
console.log(`   ✓ Provider names: ${registry.getProviderNames().join(", ")}\n`);

// Test 2: Provider Router
console.log("2. Testing ProviderRouter...");
const router = new ProviderRouter();
const testQueries = [
	"stream simpsons on youtube",
	"stream christmas movie",
	"stream futurama",
];
for (const query of testQueries) {
	const routing = router.detectProvider(query);
	console.log(
		`   Query: "${query}" → Provider: ${routing.provider || "default"}, Clean: "${routing.cleanQuery}"`
	);
}
console.log();

// Test 3: Numeric Selection Strategy
console.log("3. Testing NumericStrategy...");
const numericStrategy = new NumericStrategy();
const numericTests = ["1", "option 2", "the second one", "3"];
for (const test of numericTests) {
	const result = numericStrategy.match(test, mockSearchResults);
	console.log(
		`   "${test}" → ${result ? `Selected: "${result.selected.title}" (confidence: ${result.confidence})` : "No match"}`
	);
}
console.log();

// Test 4: Content Selector (with fuzzy matching)
console.log("4. Testing ContentSelector...");
const selector = new ContentSelector(mockSearchResults);
const selectionTests = [
	"2",
	"the one with homer",
	"simpsons season 1",
	"futurama",
];
for (const test of selectionTests) {
	const result = selector.select(test, mockSearchResults);
	if (result) {
		const autoSelect = selector.shouldAutoSelect(result);
		const suggest = selector.shouldSuggest(result);
		console.log(
			`   "${test}" → "${result.selected.title}" (${result.method}, confidence: ${result.confidence.toFixed(2)}, auto-select: ${autoSelect}, suggest: ${suggest})`
		);
	} else {
		console.log(`   "${test}" → No match`);
	}
}
console.log();

// Test 5: Time Parser
console.log("5. Testing TimeParser...");
const timeTests = ["5:30", "1:30:00", "90s", "1h30m", "2h15m30s"];
for (const test of timeTests) {
	const seconds = parseTimeString(test);
	console.log(`   "${test}" → ${seconds !== null ? `${seconds}s (${formatDuration(seconds)})` : "Invalid"}`);
}
console.log();

// Test 6: Provider Capabilities
console.log("6. Testing Provider Capabilities...");
if (youtubeProvider) {
	const capabilities = (youtubeProvider as any).getCapabilities();
	console.log(`   YouTube capabilities:`, capabilities);
}
if (jellyfinProvider) {
	const capabilities = (jellyfinProvider as any).getCapabilities();
	console.log(`   Jellyfin capabilities:`, capabilities);
}
console.log();

console.log("✅ All basic tests completed!");

