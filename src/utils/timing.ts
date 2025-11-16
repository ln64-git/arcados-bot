/**
 * Timing utilities for performance logging
 */

/**
 * Format duration in minutes:seconds.milliseconds
 * @param ms Duration in milliseconds
 * @returns Formatted string (e.g., "2:15.340" or "45.230s")
 */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const milliseconds = Math.floor(ms % 1000);

  if (minutes > 0) {
    return `${minutes}:${seconds.toString().padStart(2, "0")}.${milliseconds.toString().padStart(3, "0")}`;
  }

  return `${seconds}.${milliseconds.toString().padStart(3, "0")}s`;
}

/**
 * Time an async operation and log the result
 * @param label Label for the operation
 * @param operation Async function to time
 * @returns Result of the operation
 */
export async function timeOperation<T>(
  label: string,
  operation: () => Promise<T>
): Promise<T> {
  const start = performance.now();

  try {
    const result = await operation();
    const duration = performance.now() - start;
    console.log(`⏱️  ${label} completed in ${formatDuration(duration)}`);
    return result;
  } catch (error) {
    const duration = performance.now() - start;
    console.log(`⏱️  ${label} failed after ${formatDuration(duration)}`);
    throw error;
  }
}

/**
 * Create a timer that can be started and stopped manually
 */
export class Timer {
  private startTime: number = 0;
  private label: string;

  constructor(label: string) {
    this.label = label;
  }

  start(): void {
    this.startTime = performance.now();
  }

  end(): void {
    if (this.startTime === 0) {
      console.warn(`⚠️  Timer "${this.label}" was never started`);
      return;
    }

    const duration = performance.now() - this.startTime;
    console.log(`⏱️  ${this.label} completed in ${formatDuration(duration)}`);
    this.startTime = 0;
  }

  getDuration(): number {
    if (this.startTime === 0) {
      return 0;
    }
    return performance.now() - this.startTime;
  }
}

