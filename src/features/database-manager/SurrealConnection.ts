import { config } from "../../config";
import { SurrealHttpClient } from "./SurrealHttpClient";

let surreal: SurrealHttpClient | null = null;
let isConnecting = false;
let connectionRetries = 0;
const MAX_RETRIES = 5;
const RETRY_DELAY = 1000; // 1 second

export async function getSurrealConnection(): Promise<SurrealHttpClient> {
	if (surreal) {
		return surreal;
	}

	if (isConnecting) {
		// Wait for existing connection attempt
		await new Promise((resolve) => setTimeout(resolve, 100));
		return getSurrealConnection();
	}

	if (!config.surrealUrl) {
		throw new Error(
			"🔸 SurrealDB URL is not configured. Please set SURREAL_URL in your .env file.",
		);
	}

	// Check for either username/password OR token authentication
	if (
		!config.surrealToken &&
		(!config.surrealUsername || !config.surrealPassword)
	) {
		throw new Error(
			"🔸 SurrealDB authentication not configured. Please set either:\n" +
				"  - SURREAL_USERNAME and SURREAL_PASSWORD for basic auth, OR\n" +
				"  - SURREAL_TOKEN for OAuth2 authentication",
		);
	}

	isConnecting = true;

	try {
		surreal = new SurrealHttpClient();

		// Connect with timeout
		await Promise.race([
			surreal.connect(),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error("Connection timeout")), 10000),
			),
		]);

		connectionRetries = 0; // Reset retry counter on successful connection
		console.log("🔹 Connected to SurrealDB successfully");
		return surreal;
	} catch (error) {
		connectionRetries++;
		console.error(
			`🔸 SurrealDB connection failed (attempt ${connectionRetries}/${MAX_RETRIES}):`,
			error,
		);

		if (connectionRetries < MAX_RETRIES) {
			// Exponential backoff retry
			const delay = RETRY_DELAY * 2 ** (connectionRetries - 1);
			await new Promise((resolve) => setTimeout(resolve, delay));
			isConnecting = false;
			return getSurrealConnection();
		}

		throw new Error(
			`🔸 Failed to connect to SurrealDB after ${MAX_RETRIES} attempts: ${error}`,
		);
	} finally {
		isConnecting = false;
	}
}

export async function closeSurrealConnection(): Promise<void> {
	if (surreal) {
		try {
			await surreal.close();
		} catch (error) {
			console.warn("🔸 Error closing SurrealDB connection:", error);
		}
		surreal = null;
	}
}

// Helper function to execute queries with automatic connection management
export async function executeQuery<T = unknown>(
	query: string,
	params: Record<string, unknown> = {},
): Promise<T[]> {
	const db = await getSurrealConnection();
	try {
		return await db.query<T>(query, params);
	} catch (error) {
		console.error("🔸 SurrealDB query error:", error);
		throw error;
	}
}

// Helper function to execute a single query and return the first row
export async function executeQueryOne<T = unknown>(
	query: string,
	params: Record<string, unknown> = {},
): Promise<T | null> {
	const rows = await executeQuery<T>(query, params);
	return rows[0] || null;
}

// Helper function to execute a transaction
export async function executeTransaction<T>(
	callback: (surreal: SurrealHttpClient) => Promise<T>,
): Promise<T> {
	const surreal = await getSurrealConnection();
	try {
		// SurrealDB doesn't use traditional SQL transactions
		// It uses optimistic concurrency control instead
		const result = await callback(surreal);
		return result;
	} catch (error) {
		// SurrealDB handles rollback automatically on errors
		throw error;
	}
}

// Helper function to create a record ID
export function createRecordId(table: string, id: string): string {
	return `${table}:${id}`;
}

// Helper function to parse a record ID
export function parseRecordId(recordId: string): { table: string; id: string } {
	const [table, ...idParts] = recordId.split(":");
	return { table, id: idParts.join(":") };
}
