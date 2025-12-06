import { BaseProvider } from "../providers/BaseProvider.js";
import { MoviesProvider } from "../providers/MoviesProvider.js";
import { YouTubeProvider } from "../providers/YouTubeProvider.js";
import { JellyfinProvider } from "../providers/JellyfinProvider.js";
import { ChristmasMoviesProvider } from "../providers/ChristmasMoviesProvider.js";

/**
 * Registry for managing streaming providers
 * Extracted from StreamPlayerManager for better separation of concerns
 */
export class ProviderRegistry {
	private static instance: ProviderRegistry;
	private providers: Map<string, BaseProvider> = new Map();

	private constructor() {
		this.registerDefaultProviders();
	}

	public static getInstance(): ProviderRegistry {
		if (!ProviderRegistry.instance) {
			ProviderRegistry.instance = new ProviderRegistry();
		}
		return ProviderRegistry.instance;
	}

	/**
	 * Register default providers
	 */
	private registerDefaultProviders(): void {
		const moviesProvider = new MoviesProvider();
		this.providers.set("123movies", moviesProvider);
		this.providers.set("default", moviesProvider);

		const youtubeProvider = new YouTubeProvider();
		this.providers.set("youtube", youtubeProvider);

		const jellyfinProvider = new JellyfinProvider();
		this.providers.set("jellyfin", jellyfinProvider);

		const christmasMoviesProvider = new ChristmasMoviesProvider();
		this.providers.set("christmas-movies", christmasMoviesProvider);
	}

	/**
	 * Get a provider by name
	 * @param name Provider name
	 * @returns Provider instance or null if not found
	 */
	public getProvider(name: string): BaseProvider | null {
		return this.providers.get(name) || null;
	}

	/**
	 * Register a custom provider
	 * @param name Provider name
	 * @param provider Provider instance
	 */
	public registerProvider(name: string, provider: BaseProvider): void {
		this.providers.set(name, provider);
	}

	/**
	 * Get all registered provider names
	 * @returns Array of provider names
	 */
	public getProviderNames(): string[] {
		return Array.from(this.providers.keys());
	}

	/**
	 * Check if a provider is registered
	 * @param name Provider name
	 * @returns True if provider exists
	 */
	public hasProvider(name: string): boolean {
		return this.providers.has(name);
	}
}

