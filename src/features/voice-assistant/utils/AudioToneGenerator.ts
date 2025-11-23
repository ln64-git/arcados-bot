/**
 * Generates simple audio tones for notification sounds
 * Produces PCM audio at 48kHz stereo (compatible with Discord voice)
 */
export class AudioToneGenerator {
	/**
	 * Generate a pleasant "thinking" chime sound
	 * Creates a gentle two-tone descending chime
	 *
	 * @returns WAV audio buffer (PCM, 48kHz stereo) with proper headers for Discord
	 */
	public static generateThinkingChime(): Buffer {
		const sampleRate = 48000; // Discord voice uses 48kHz
		const channels = 2; // Stereo
		const bitsPerSample = 16;
		const duration = 0.2; // 200ms - quick and subtle
		const totalSamples = Math.floor(sampleRate * duration);

		// Create buffer for PCM data
		const pcmData = Buffer.alloc(totalSamples * channels * 2); // 2 bytes per sample

		// Pleasant two-tone chime: 880 Hz -> 660 Hz (descending musical fifth)
		const freq1 = 880; // A5
		const freq2 = 660; // E5
		const crossoverPoint = totalSamples * 0.5; // Switch at halfway point

		let bufferOffset = 0;

		// Generate two-tone chime
		for (let i = 0; i < totalSamples; i++) {
			const t = i / sampleRate;
			const progress = i / totalSamples; // 0 to 1

			// Determine which frequency to use
			const frequency = i < crossoverPoint ? freq1 : freq2;

			// Very smooth envelope with exponential decay
			const attackTime = 0.05; // 5% of duration for attack
			const attack = progress < attackTime ? progress / attackTime : 1;
			const decay = Math.exp(-5 * progress); // Exponential decay
			const envelope = attack * decay;

			// Generate sine wave with envelope
			const amplitude = 0.3; // 30% max amplitude - audible but not jarring
			const value = Math.sin(2 * Math.PI * frequency * t) * envelope * amplitude;

			// Convert to 16-bit signed integer with clamping
			const sample = Math.max(
				-32767,
				Math.min(32767, Math.round(value * 32767))
			);

			// Write to both channels (stereo)
			pcmData.writeInt16LE(sample, bufferOffset);
			pcmData.writeInt16LE(sample, bufferOffset + 2);
			bufferOffset += 4;
		}

		// Create WAV header for proper format detection
		const byteRate = (sampleRate * channels * bitsPerSample) / 8;
		const blockAlign = (channels * bitsPerSample) / 8;
		const dataSize = pcmData.length;
		const header = Buffer.alloc(44);

		// "RIFF" chunk descriptor
		header.write("RIFF", 0);
		header.writeUInt32LE(36 + dataSize, 4); // File size - 8
		header.write("WAVE", 8);

		// "fmt " sub-chunk
		header.write("fmt ", 12);
		header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
		header.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
		header.writeUInt16LE(channels, 22);
		header.writeUInt32LE(sampleRate, 24);
		header.writeUInt32LE(byteRate, 28);
		header.writeUInt16LE(blockAlign, 32);
		header.writeUInt16LE(bitsPerSample, 34);

		// "data" sub-chunk
		header.write("data", 36);
		header.writeUInt32LE(dataSize, 40);

		// Combine header and PCM data
		return Buffer.concat([header, pcmData]);
	}

	/**
	 * Generate a simple acknowledgment beep
	 * Single tone, very short
	 *
	 * @returns PCM audio buffer (LINEAR16, 48kHz stereo)
	 */
	public static generateAcknowledgmentBeep(): Buffer {
		const sampleRate = 48000;
		const channels = 2;
		const duration = 0.1; // 100ms
		const frequency = 880; // A5 note
		const samples = Math.floor(sampleRate * duration);

		const buffer = Buffer.alloc(samples * channels * 2);

		for (let i = 0; i < samples; i++) {
			const t = i / sampleRate;

			// Quick fade in/out
			const fadeIn = Math.min(1, i / (sampleRate * 0.01));
			const fadeOut = Math.max(0, 1 - i / samples);
			const envelope = fadeIn * fadeOut;

			const value = Math.sin(2 * Math.PI * frequency * t) * envelope * 0.25;
			const sample = Math.floor(value * 32767);

			buffer.writeInt16LE(sample, i * 4);
			buffer.writeInt16LE(sample, i * 4 + 2);
		}

		return buffer;
	}

	/**
	 * Generate an error tone
	 * Lower pitch, slightly longer to indicate an issue
	 *
	 * @returns WAV audio buffer (PCM, 48kHz stereo)
	 */
	public static generateErrorTone(): Buffer {
		const sampleRate = 48000;
		const channels = 2;
		const bitsPerSample = 16;
		const duration = 0.2; // 200ms
		const frequency = 440; // A4 - lower pitch for errors
		const totalSamples = Math.floor(sampleRate * duration);

		// Create buffer for PCM data
		const pcmData = Buffer.alloc(totalSamples * channels * 2);

		let bufferOffset = 0;

		for (let i = 0; i < totalSamples; i++) {
			const t = i / sampleRate;
			const progress = i / totalSamples;

			// Gentle attack and decay
			const attackTime = 0.1;
			const attack = progress < attackTime ? progress / attackTime : 1;
			const decay = Math.exp(-3 * progress);
			const envelope = attack * decay;

			// Generate sine wave with envelope
			const amplitude = 0.25; // 25% max amplitude
			const value = Math.sin(2 * Math.PI * frequency * t) * envelope * amplitude;

			// Convert to 16-bit signed integer
			const sample = Math.max(
				-32767,
				Math.min(32767, Math.round(value * 32767))
			);

			// Write to both channels (stereo)
			pcmData.writeInt16LE(sample, bufferOffset);
			pcmData.writeInt16LE(sample, bufferOffset + 2);
			bufferOffset += 4;
		}

		// Create WAV header
		const byteRate = (sampleRate * channels * bitsPerSample) / 8;
		const blockAlign = (channels * bitsPerSample) / 8;
		const dataSize = pcmData.length;
		const header = Buffer.alloc(44);

		// "RIFF" chunk descriptor
		header.write("RIFF", 0);
		header.writeUInt32LE(36 + dataSize, 4);
		header.write("WAVE", 8);

		// "fmt " sub-chunk
		header.write("fmt ", 12);
		header.writeUInt32LE(16, 16);
		header.writeUInt16LE(1, 20); // PCM
		header.writeUInt16LE(channels, 22);
		header.writeUInt32LE(sampleRate, 24);
		header.writeUInt32LE(byteRate, 28);
		header.writeUInt16LE(blockAlign, 32);
		header.writeUInt16LE(bitsPerSample, 34);

		// "data" sub-chunk
		header.write("data", 36);
		header.writeUInt32LE(dataSize, 40);

		// Combine header and PCM data
		return Buffer.concat([header, pcmData]);
	}
}
