import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createReadStream } from "node:fs";
import { basename, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";

export interface ImageInfo {
	localPath: string;
	fileSize: number;
	contentType: string;
	fileName: string;
}

export class ImageStorage {
	private baseDir: string;

	constructor(baseDir = "./storage/avatars") {
		this.baseDir = baseDir;
		this.ensureDirectoryExists();
	}

	private ensureDirectoryExists(): void {
		if (!existsSync(this.baseDir)) {
			mkdirSync(this.baseDir, { recursive: true });
		}
	}

	/**
	 * Download and store an image from a URL
	 */
	async storeImage(
		imageUrl: string,
		userId: string,
		avatarHash?: string,
	): Promise<ImageInfo | null> {
		try {
			// Generate filename based on user ID and avatar hash
			const urlExt = extname(new URL(imageUrl).pathname) || ".png";
			const fileName = avatarHash
				? `${userId}_${avatarHash}${urlExt}`
				: `${userId}_${Date.now()}${urlExt}`;

			const localPath = join(this.baseDir, fileName);

			// Check if file already exists
			if (existsSync(localPath)) {
				const stats = statSync(localPath);
				return {
					localPath,
					fileSize: stats.size,
					contentType: this.getContentTypeFromExtension(urlExt),
					fileName,
				};
			}

			// Download the image
			const response = await fetch(imageUrl);
			if (!response.ok) {
				throw new Error(`Failed to fetch image: ${response.statusText}`);
			}

			const contentType = response.headers.get("content-type") || "image/png";
			const buffer = await response.arrayBuffer();

			// Write to file
			await pipeline(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new Uint8Array(buffer));
						controller.close();
					},
				}),
				new WritableStream({
					write(chunk) {
						return new Promise((resolve, reject) => {
							const writeStream = createWriteStream(localPath);
							writeStream.write(chunk, (error) => {
								if (error) reject(error);
								else resolve();
							});
							writeStream.end();
						});
					},
				}),
			);

			const stats = statSync(localPath);
			return {
				localPath,
				fileSize: stats.size,
				contentType,
				fileName,
			};
		} catch (error) {
			console.error("🔸 Error storing image:", error);
			return null;
		}
	}

	/**
	 * Get image info for an existing file
	 */
	getImageInfo(localPath: string): ImageInfo | null {
		try {
			if (!existsSync(localPath)) {
				return null;
			}

			const stats = statSync(localPath);
			const fileName = basename(localPath);
			const ext = extname(localPath);

			return {
				localPath,
				fileSize: stats.size,
				contentType: this.getContentTypeFromExtension(ext),
				fileName,
			};
		} catch (error) {
			console.error("🔸 Error getting image info:", error);
			return null;
		}
	}

	/**
	 * Delete an image file
	 */
	async deleteImage(localPath: string): Promise<boolean> {
		try {
			if (existsSync(localPath)) {
				const { unlink } = await import("node:fs/promises");
				await unlink(localPath);
				return true;
			}
			return false;
		} catch (error) {
			console.error("🔸 Error deleting image:", error);
			return false;
		}
	}

	/**
	 * Get image as base64 for embedding
	 */
	async getImageAsBase64(localPath: string): Promise<string | null> {
		try {
			if (!existsSync(localPath)) {
				return null;
			}

			const buffer = await new Promise<Buffer>((resolve, reject) => {
				const chunks: Buffer[] = [];
				const stream = createReadStream(localPath);

				stream.on("data", (chunk) => chunks.push(chunk));
				stream.on("end", () => resolve(Buffer.concat(chunks)));
				stream.on("error", reject);
			});

			return buffer.toString("base64");
		} catch (error) {
			console.error("🔸 Error reading image as base64:", error);
			return null;
		}
	}

	/**
	 * Clean up old images (older than specified days)
	 */
	async cleanupOldImages(daysOld = 30): Promise<number> {
		try {
			const { readdir, stat, unlink } = await import("node:fs/promises");
			const files = await readdir(this.baseDir);
			const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
			let deletedCount = 0;

			for (const file of files) {
				const filePath = join(this.baseDir, file);
				const stats = await stat(filePath);

				if (stats.mtime < cutoffDate) {
					await unlink(filePath);
					deletedCount++;
				}
			}

			console.log(`🧹 Cleaned up ${deletedCount} old avatar images`);
			return deletedCount;
		} catch (error) {
			console.error("🔸 Error cleaning up old images:", error);
			return 0;
		}
	}

	/**
	 * Get total storage size
	 */
	async getStorageSize(): Promise<number> {
		try {
			const { readdir, stat } = await import("node:fs/promises");
			const files = await readdir(this.baseDir);
			let totalSize = 0;

			for (const file of files) {
				const filePath = join(this.baseDir, file);
				const stats = await stat(filePath);
				totalSize += stats.size;
			}

			return totalSize;
		} catch (error) {
			console.error("🔸 Error calculating storage size:", error);
			return 0;
		}
	}

	private getContentTypeFromExtension(ext: string): string {
		const contentTypes: Record<string, string> = {
			".png": "image/png",
			".jpg": "image/jpeg",
			".jpeg": "image/jpeg",
			".gif": "image/gif",
			".webp": "image/webp",
			".svg": "image/svg+xml",
		};

		return contentTypes[ext.toLowerCase()] || "image/png";
	}
}

// Singleton instance
export const imageStorage = new ImageStorage();
