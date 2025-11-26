import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { config } from "../../../../../config/index.js";

/**
 * Manages the lifecycle of the local Whisper server process
 * Automatically starts and stops the Whisper server with the bot
 */
export class WhisperServerManager {
	private static instance: WhisperServerManager;
	private whisperProcess: ChildProcess | null = null;
	private isStarting = false;
	private startupTimeout: NodeJS.Timeout | null = null;

	// Configuration
	private readonly WHISPER_BINARY = "whisper-server";
	private readonly WHISPER_MODEL_PATH =
		"/home/ln64/.voicemode/services/whisper/models/ggml-medium.bin";
	private readonly WHISPER_PORT = 8086;
	private readonly STARTUP_TIMEOUT_MS = 30000; // 30 seconds to start
	private readonly SHUTDOWN_TIMEOUT_MS = 5000; // 5 seconds to stop gracefully

	private constructor() { }

	public static getInstance(): WhisperServerManager {
		if (!WhisperServerManager.instance) {
			WhisperServerManager.instance = new WhisperServerManager();
		}
		return WhisperServerManager.instance;
	}

	/**
	 * Start the Whisper server if not already running
	 * @returns True if started successfully or already running
	 */
	public async start(): Promise<boolean> {
		// Check if Whisper URL is configured (if not, user wants to use OpenAI)
		if (!config.whisperUrl) {
			console.log(
				"🎤 WHISPER_URL not configured, skipping local Whisper server startup"
			);
			return false;
		}

		// Check if already running
		if (this.whisperProcess) {
			console.log("🎤 Server already running");
			return true;
		}

		// Check if already starting
		if (this.isStarting) {
			console.log("🎤 Server is already starting...");
			return false;
		}

		this.isStarting = true;

		try {
			// Check if model file exists
			if (!existsSync(this.WHISPER_MODEL_PATH)) {
				console.error(
					`🎤 Model file not found: ${this.WHISPER_MODEL_PATH}`
				);
				console.error(
					"🎤 Please download the model file or update WHISPER_MODEL_PATH in the code"
				);
				this.isStarting = false;
				return false;
			}

			console.log("🎤 Starting Whisper server...");
			console.log(`🎤 Binary: ${this.WHISPER_BINARY}`);
			console.log(`🎤 Model: ${this.WHISPER_MODEL_PATH}`);
			console.log(`🎤 Port: ${this.WHISPER_PORT}`);

			// Kill any existing Whisper processes on this port
			await this.killExistingProcesses();

			// Spawn Whisper server process
			this.whisperProcess = spawn(
				this.WHISPER_BINARY,
				[
					"-m",
					this.WHISPER_MODEL_PATH,
					"--host",
					"0.0.0.0",
					"--port",
					this.WHISPER_PORT.toString(),
				],
				{
					detached: false, // Keep it attached to this process
					stdio: ["ignore", "pipe", "pipe"], // Capture stdout/stderr
				}
			);

			// Set up event handlers
			this.setupProcessHandlers();

			// Wait for server to be ready
			const isReady = await this.waitForServerReady();

			if (isReady) {
				console.log(
					`🎤 Server started successfully on port ${this.WHISPER_PORT}`
				);
				this.isStarting = false;
				return true;
			} else {
				console.error("🎤 Failed to start server (timeout)");
				await this.stop();
				this.isStarting = false;
				return false;
			}
		} catch (error) {
			console.error("🎤 Error starting server:", error);
			this.isStarting = false;
			return false;
		}
	}

	/**
	 * Stop the Whisper server gracefully
	 */
	public async stop(): Promise<void> {
		if (!this.whisperProcess) {
			return;
		}

		console.log("🎤 Stopping Whisper server...");

		// Clear startup timeout if still pending
		if (this.startupTimeout) {
			clearTimeout(this.startupTimeout);
			this.startupTimeout = null;
		}

		return new Promise((resolve) => {
			if (!this.whisperProcess) {
				resolve();
				return;
			}

			const process = this.whisperProcess;
			const pid = process.pid;

			// Set up timeout for forceful kill
			const forceKillTimeout = setTimeout(() => {
				if (process && !process.killed) {
					console.warn(
						`🎤 Force killing process (PID: ${pid}) after timeout`
					);
					process.kill("SIGKILL");
				}
			}, this.SHUTDOWN_TIMEOUT_MS);

			// Wait for process to exit
			process.once("exit", () => {
				clearTimeout(forceKillTimeout);
				console.log("🎤 ✓ Server stopped");
				this.whisperProcess = null;
				resolve();
			});

			// Send SIGTERM for graceful shutdown
			console.log(`🎤 Sending SIGTERM to PID ${pid}...`);
			process.kill("SIGTERM");
		});
	}

	/**
	 * Check if the Whisper server is running
	 */
	public isRunning(): boolean {
		return this.whisperProcess !== null && !this.whisperProcess.killed;
	}

	/**
	 * Set up process event handlers
	 */
	private setupProcessHandlers(): void {
		if (!this.whisperProcess) {
			return;
		}

		const process = this.whisperProcess;

		// Patterns to suppress (verbose/noise logs)
		const suppressPatterns = [
			/^system_info:/,
			/^operator\(\):/,
			/^whisper_init/,
			/^whisper_model_load:/,
			/^whisper_backend/,
			/^ggml_/,
			/^register_/,
			/processing 'audio\.wav'/,
			/n_threads =/,
			/WHISPER :/,
			/CPU :/,
			/use gpu/,
			/flash attn/,
			/gpu_device/,
			/dtw/,
			/devices/,
			/backends/,
			/Successfully loaded/,
			/Running whisper\.cpp inference/,
			/Received request:/,
		];

		const shouldSuppress = (text: string): boolean => {
			return suppressPatterns.some((pattern) => pattern.test(text));
		};

		// Log stdout (with filtering)
		process.stdout?.on("data", (data) => {
			const output = data.toString().trim();
			if (output && !shouldSuppress(output)) {
				console.log(`🎤 ${output}`);
			}
		});

		// Collect stderr for error reporting
		let stderrBuffer = "";

		// Log stderr (with filtering)
		process.stderr?.on("data", (data) => {
			const output = data.toString().trim();
			// Always collect stderr for error reporting
			stderrBuffer += output + "\n";
			if (output && !shouldSuppress(output)) {
				console.error(`🎤 ${output}`);
			}
		});

		// Handle process exit
		process.on("exit", (code, signal) => {
			if (code !== 0 && code !== null) {
				console.error(
					`🎤 Process exited with code ${code} (signal: ${signal})`
				);
				// Show stderr if available for debugging
				if (stderrBuffer.trim()) {
					const errorLines = stderrBuffer
						.split("\n")
						.filter((line) => line.trim() && !shouldSuppress(line.trim()))
						.slice(0, 5); // Show first 5 non-suppressed error lines
					if (errorLines.length > 0) {
						console.error("🎤 Error details:");
						errorLines.forEach((line) => console.error(`🎤   ${line}`));
					}
				}
			}
			this.whisperProcess = null;
		});

		// Handle errors
		process.on("error", (error) => {
			console.error("🎤 Process error:", error);
			this.whisperProcess = null;
		});
	}

	/**
	 * Wait for server to be ready by polling the health endpoint
	 */
	private async waitForServerReady(): Promise<boolean> {
		const startTime = Date.now();
		const pollInterval = 500; // Check every 500ms

		while (Date.now() - startTime < this.STARTUP_TIMEOUT_MS) {
			try {
				const response = await fetch(
					`http://localhost:${this.WHISPER_PORT}/health`,
					{
						signal: AbortSignal.timeout(1000), // 1 second timeout per request
					}
				);

				if (response.ok) {
					const data = (await response.json()) as { status?: string };
					if (data.status === "ok") {
						return true;
					}
				}
			} catch {
				// Server not ready yet, continue polling
			}

			// Wait before next poll
			await new Promise((resolve) => setTimeout(resolve, pollInterval));
		}

		return false;
	}

	/**
	 * Kill any existing Whisper processes on the configured port
	 */
	private async killExistingProcesses(): Promise<void> {
		try {
			const { execSync } = await import("node:child_process");

			// Find processes using the port
			const lsofCommand = `lsof -ti:${this.WHISPER_PORT} 2>/dev/null || true`;
			const pids = execSync(lsofCommand, { encoding: "utf-8" })
				.trim()
				.split("\n")
				.filter((pid) => pid.length > 0);

			if (pids.length > 0) {
				console.log(
					`🎤 Killing ${pids.length} existing process(es) on port ${this.WHISPER_PORT}...`
				);
				for (const pid of pids) {
					try {
						execSync(`kill -9 ${pid}`, { stdio: "ignore" });
					} catch {
						// Process might already be dead
					}
				}
				// Wait a moment for processes to die
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
		} catch (error) {
			// lsof might not be available or other error - not critical
			console.warn(
				"🎤 Could not check for existing processes:",
				error
			);
		}
	}

	/**
	 * Restart the Whisper server
	 */
	public async restart(): Promise<boolean> {
		console.log("🎤 Restarting server...");
		await this.stop();
		return await this.start();
	}
}
