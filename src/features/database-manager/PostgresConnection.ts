import { Pool, type PoolClient, type PoolConfig } from "pg";
import { config } from "../../config";

let pool: Pool | null = null;
let isConnecting = false;
let connectionRetries = 0;
const MAX_RETRIES = 5;
const RETRY_DELAY = 1000; // 1 second

// Optimized connection options for production
const poolConfig: PoolConfig = {
	max: 10, // Maximum number of clients in the pool
	min: 2, // Minimum number of clients in the pool
	idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
	connectionTimeoutMillis: 10000, // How long to wait for a connection
	query_timeout: 45000, // Query timeout
	keepAlive: true,
	keepAliveInitialDelayMillis: 10000,
};

export async function getPostgresPool(): Promise<Pool> {
	if (pool) {
		return pool;
	}

	if (isConnecting) {
		// Wait for existing connection attempt
		await new Promise((resolve) => setTimeout(resolve, 100));
		return getPostgresPool();
	}

	if (!config.postgresUrl) {
		throw new Error(
			"🔸 PostgreSQL URL is not configured. Please set POSTGRES_URL in your .env file.",
		);
	}

	isConnecting = true;

	try {
		pool = new Pool({
			...poolConfig,
			connectionString: config.postgresUrl,
		});

		// Test the connection with timeout
		const client = await pool.connect();
		try {
			await Promise.race([
				client.query("SELECT 1"),
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error("Connection timeout")), 5000),
				),
			]);
		} finally {
			client.release();
		}

		connectionRetries = 0; // Reset retry counter on successful connection
		return pool;
	} catch (error) {
		connectionRetries++;
		console.error(
			`🔸 PostgreSQL connection failed (attempt ${connectionRetries}/${MAX_RETRIES}):`,
			error,
		);

		if (connectionRetries < MAX_RETRIES) {
			// Exponential backoff retry
			const delay = RETRY_DELAY * 2 ** (connectionRetries - 1);
			await new Promise((resolve) => setTimeout(resolve, delay));
			isConnecting = false;
			return getPostgresPool();
		}

		throw new Error(
			`🔸 Failed to connect to PostgreSQL after ${MAX_RETRIES} attempts: ${error}`,
		);
	} finally {
		isConnecting = false;
	}
}

export async function getPostgresClient(): Promise<PoolClient> {
	const pool = await getPostgresPool();
	return pool.connect();
}

export async function closePostgresPool(): Promise<void> {
	if (pool) {
		await pool.end();
		pool = null;
	}
}

// Helper function to convert snake_case to camelCase
function snakeToCamel(str: string): string {
	return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

// Helper function to map database row to camelCase object
function mapRowToCamelCase(
	row: Record<string, unknown>,
): Record<string, unknown> {
	const mapped: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(row)) {
		mapped[snakeToCamel(key)] = value;
	}
	return mapped;
}

// Helper function to execute queries with automatic client management
export async function executeQuery<T = unknown>(
	query: string,
	params: unknown[] = [],
): Promise<T[]> {
	const client = await getPostgresClient();
	try {
		const result = await client.query(query, params);
		return result.rows.map((row: Record<string, unknown>) =>
			mapRowToCamelCase(row),
		) as T[];
	} finally {
		client.release();
	}
}

// Helper function to execute a single query and return the first row
export async function executeQueryOne<T = unknown>(
	query: string,
	params: unknown[] = [],
): Promise<T | null> {
	const rows = await executeQuery<T>(query, params);
	return rows[0] || null;
}

// Helper function to execute a transaction
export async function executeTransaction<T>(
	callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
	const client = await getPostgresClient();
	try {
		await client.query("BEGIN");
		const result = await callback(client);
		await client.query("COMMIT");
		return result;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}
