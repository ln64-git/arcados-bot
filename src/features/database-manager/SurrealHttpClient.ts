import { config } from "../../config";

export class SurrealHttpClient {
	private baseUrl: string;
	private token: string | null = null;
	private username: string | null = null;
	private password: string | null = null;
	private namespace: string;
	private database: string;

	constructor() {
		if (!config.surrealUrl) {
			throw new Error("SURREAL_URL not configured");
		}

		// Convert WebSocket URL to HTTP URL
		this.baseUrl = config.surrealUrl
			.replace("wss://", "https://")
			.replace("ws://", "http://")
			.replace("/rpc", "/sql");

		this.namespace = config.surrealNamespace || "arcados";
		this.database = config.surrealDatabase || "discord_bot";
	}

	async connect(): Promise<void> {
		// Authenticate if we have credentials
		if (config.surrealToken) {
			await this.authenticate(config.surrealToken);
		} else if (config.surrealUsername && config.surrealPassword) {
			await this.signin(config.surrealUsername, config.surrealPassword);
		}
	}

	async authenticate(token: string): Promise<void> {
		this.token = token;
		// Test the connection with a simple query
		try {
			await this.query("SELECT * FROM users LIMIT 1");
		} catch (error) {
			console.error("🔸 Authentication test failed:", error);
			throw error;
		}
	}

	async signin(username: string, password: string): Promise<void> {
		// Store credentials for HTTP Basic Auth
		this.username = username;
		this.password = password;

		// Test the connection with a simple query
		try {
			await this.query("SELECT * FROM users LIMIT 1");
		} catch (error) {
			console.error("🔸 Authentication test failed:", error);
			throw error;
		}
	}

	async query<T = unknown>(
		query: string,
		params?: Record<string, unknown>,
	): Promise<T[]> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: "application/json",
			"Surreal-NS": this.namespace,
			"Surreal-DB": this.database,
		};

		// Use HTTP Basic Auth if username/password are available
		if (this.username && this.password) {
			const credentials = btoa(`${this.username}:${this.password}`);
			headers["Authorization"] = `Basic ${credentials}`;
		} else if (this.token) {
			headers["Authorization"] = `Bearer ${this.token}`;
		}

		const response = await fetch(`${this.baseUrl}/sql`, {
			method: "POST",
			headers: {
				...headers,
				"Content-Type": "text/plain",
			},
			body: query,
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error(
				`🔸 SurrealDB query failed: ${response.statusText}`,
				errorText,
			);
			throw new Error(`Query failed: ${response.statusText} - ${errorText}`);
		}

		const result = await response.json();

		// Check for query-level errors in SurrealDB response
		if (result[0]?.status === "ERR") {
			// Check if it's a non-fatal "already exists" error
			const errorMessage = result[0]?.result || result[0]?.detail || "";
			if (errorMessage.includes("already exists")) {
				// Continue execution for "already exists" errors
			} else {
				console.error("🔸 SurrealDB query error:", errorMessage);
				throw new Error(`Query error: ${errorMessage}`);
			}
		}

		// Check for HTTP-level errors in the response
		if (result[0]?.error) {
			console.error("🔸 SurrealDB query error:", result[0]?.error);
			throw new Error(`Query error: ${result[0]?.error}`);
		}

		// SurrealDB returns different response formats
		// Sometimes it's { result: [...] }, sometimes it's the actual data
		let actualResult = result;
		if (Array.isArray(result) && result.length > 0) {
			// If it's an array, check if the first element has a result property
			if (result[0]?.result !== undefined) {
				actualResult = result[0].result;
			} else if (result[0]?.status === "OK") {
				// For successful operations, the data might be in the result array itself
				actualResult = result;
			}
		}

		return Array.isArray(actualResult) ? actualResult : [];
	}

	async queryOne<T = unknown>(
		query: string,
		params?: Record<string, unknown>,
	): Promise<T | null> {
		const results = await this.query<T>(query, params);
		return results[0] || null;
	}

	async create<T = unknown>(
		table: string,
		data: Record<string, unknown>,
	): Promise<T[]> {
		const query = `CREATE ${table} CONTENT $data`;
		return await this.query<T>(query, { data });
	}

	async update<T = unknown>(
		table: string,
		id: string,
		data: Record<string, unknown>,
	): Promise<T[]> {
		const query = `UPDATE ${table}:${id} MERGE $data`;
		return await this.query<T>(query, { data });
	}

	async select<T = unknown>(table: string, id?: string): Promise<T[]> {
		const query = id
			? `SELECT * FROM ${table}:${id}`
			: `SELECT * FROM ${table}`;
		return await this.query<T>(query);
	}

	async delete(table: string, id: string): Promise<void> {
		await this.query(`DELETE ${table}:${id}`);
	}

	async close(): Promise<void> {
		// HTTP client doesn't need explicit closing
		this.token = null;
	}
}
