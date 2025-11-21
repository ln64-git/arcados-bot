import { config } from "../../../config/index.js";
import type { AudioChunk } from "../types.js";

/**
 * Whisper speech-to-text transcription service
 * Supports local Whisper (preferred) with OpenAI API fallback
 */
export class WhisperTranscriber {
	private static instance: WhisperTranscriber;
	private readonly whisperUrl?: string;
	private readonly whisperApiKey?: string;
	private readonly openaiApiKey?: string;

	private constructor() {
		this.whisperUrl = config.whisperUrl;
		this.whisperApiKey = config.whisperApiKey;
		this.openaiApiKey = config.openaiApiKey;
	}

	public static getInstance(): WhisperTranscriber {
		if (!WhisperTranscriber.instance) {
			WhisperTranscriber.instance = new WhisperTranscriber();
		}
		return WhisperTranscriber.instance;
	}

	/**
	 * Transcribe audio chunk to text
	 *
	 * @param audioChunk Audio chunk with PCM data
	 * @returns Transcribed text
	 */
	public async transcribe(audioChunk: AudioChunk): Promise<string> {
		// TEMPORARY: Mock transcription for testing
		// Remove this when you have Whisper set up
		if (!this.whisperUrl && !this.openaiApiKey) {
			console.warn(
				"[WhisperTranscriber] No transcription service configured, using mock transcription"
			);
			// Return a mock transcription that contains "aria" for testing
			return "aria hello can you hear me";
		}

		// Try local Whisper first (free and fast)
		if (this.whisperUrl) {
			try {
				return await this.transcribeLocal(audioChunk);
			} catch (error) {
				console.warn("Local Whisper transcription failed, falling back to OpenAI API:", error);
			}
		}

		// Fallback to OpenAI Whisper API
		if (this.openaiApiKey) {
			try {
				return await this.transcribeOpenAI(audioChunk);
			} catch (error) {
				console.error("OpenAI Whisper transcription failed:", error);
				throw new Error("All transcription methods failed");
			}
		}

		throw new Error(
			"No Whisper transcription service configured. Set WHISPER_URL for local or OPENAI_API_KEY for cloud."
		);
	}

	/**
	 * Transcribe using local Whisper endpoint
	 * Supports both OpenAI-compatible API and whisper.cpp server
	 *
	 * @param audioChunk Audio chunk to transcribe
	 * @returns Transcribed text
	 */
	private async transcribeLocal(audioChunk: AudioChunk): Promise<string> {
		if (!this.whisperUrl) {
			throw new Error("Local Whisper URL not configured");
		}

		// Convert PCM to WAV format
		const wavBuffer = this.pcmToWav(audioChunk);

		// Create form data for multipart upload
		const formData = new FormData();
		const audioBlob = new Blob([wavBuffer], { type: "audio/wav" });
		formData.append("file", audioBlob, "audio.wav");

		const headers: Record<string, string> = {};
		if (this.whisperApiKey) {
			headers.Authorization = `Bearer ${this.whisperApiKey}`;
		}

		// Try whisper.cpp endpoint first (/inference)
		try {
			formData.append("temperature", "0.0");
			formData.append("temperature_inc", "0.2");
			formData.append("response_format", "json");

			const response = await fetch(`${this.whisperUrl}/inference`, {
				method: "POST",
				headers,
				body: formData,
			});

			if (response.ok) {
				const result = (await response.json()) as { text?: string };
				if (result.text) {
					return result.text.trim();
				}
			}
		} catch (error) {
			console.warn("[WhisperTranscriber] whisper.cpp /inference failed, trying OpenAI-compatible endpoint");
		}

		// Try OpenAI-compatible endpoint (/v1/audio/transcriptions)
		const formData2 = new FormData();
		formData2.append("file", audioBlob, "audio.wav");
		formData2.append("model", "whisper-1");
		formData2.append("language", "en");

		const response = await fetch(`${this.whisperUrl}/v1/audio/transcriptions`, {
			method: "POST",
			headers,
			body: formData2,
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Local Whisper API error (${response.status}): ${errorText}`);
		}

		const result = (await response.json()) as { text?: string };

		if (!result.text) {
			throw new Error("Local Whisper API returned no transcription");
		}

		return result.text.trim();
	}

	/**
	 * Transcribe using OpenAI Whisper API
	 *
	 * @param audioChunk Audio chunk to transcribe
	 * @returns Transcribed text
	 */
	private async transcribeOpenAI(audioChunk: AudioChunk): Promise<string> {
		if (!this.openaiApiKey) {
			throw new Error("OpenAI API key not configured");
		}

		// Convert PCM to WAV format
		const wavBuffer = this.pcmToWav(audioChunk);

		// Create form data for multipart upload
		const formData = new FormData();
		const audioBlob = new Blob([wavBuffer], { type: "audio/wav" });
		formData.append("file", audioBlob, "audio.wav");
		formData.append("model", "whisper-1");
		formData.append("language", "en");

		const response = await fetch(
			"https://api.openai.com/v1/audio/transcriptions",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.openaiApiKey}`,
				},
				body: formData,
			}
		);

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`OpenAI Whisper API error (${response.status}): ${errorText}`);
		}

		const result = (await response.json()) as { text?: string };

		if (!result.text) {
			throw new Error("OpenAI Whisper API returned no transcription");
		}

		return result.text.trim();
	}

	/**
	 * Convert PCM audio to WAV format
	 * Whisper API expects WAV, MP3, or other standard formats
	 *
	 * @param audioChunk Audio chunk with PCM data
	 * @returns WAV file buffer
	 */
	private pcmToWav(audioChunk: AudioChunk): Buffer {
		const { data, sampleRate, channels } = audioChunk;

		// WAV file header (44 bytes)
		const header = Buffer.alloc(44);

		// RIFF chunk descriptor
		header.write("RIFF", 0); // ChunkID
		header.writeUInt32LE(36 + data.length, 4); // ChunkSize
		header.write("WAVE", 8); // Format

		// fmt sub-chunk
		header.write("fmt ", 12); // Subchunk1ID
		header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
		header.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
		header.writeUInt16LE(channels, 22); // NumChannels
		header.writeUInt32LE(sampleRate, 24); // SampleRate
		header.writeUInt32LE(sampleRate * channels * 2, 28); // ByteRate
		header.writeUInt16LE(channels * 2, 32); // BlockAlign
		header.writeUInt16LE(16, 34); // BitsPerSample

		// data sub-chunk
		header.write("data", 36); // Subchunk2ID
		header.writeUInt32LE(data.length, 40); // Subchunk2Size

		// Combine header and PCM data
		return Buffer.concat([header, data]);
	}

	/**
	 * Check if transcription service is configured
	 */
	public isConfigured(): boolean {
		return !!(this.whisperUrl || this.openaiApiKey);
	}

	/**
	 * Get configured transcription method
	 */
	public getTranscriptionMethod(): "local" | "openai" | "none" {
		if (this.whisperUrl) return "local";
		if (this.openaiApiKey) return "openai";
		return "none";
	}
}
