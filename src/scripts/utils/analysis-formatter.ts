/**
 * Shared formatting utilities for analysis scripts
 * Provides consistent, beautiful output formatting
 */

export interface TableColumn {
	header: string;
	width: number;
	align?: "left" | "right" | "center";
}

export class AnalysisFormatter {
	/**
	 * Print a section header with title
	 */
	static section(title: string, width = 75): void {
		const padding = Math.max(0, width - title.length - 2);
		const leftPad = Math.floor(padding / 2);
		const rightPad = padding - leftPad;
		console.log("\n" + "═".repeat(width));
		console.log(" ".repeat(leftPad) + title + " ".repeat(rightPad));
		console.log("═".repeat(width) + "\n");
	}

	/**
	 * Print a subsection header
	 */
	static subsection(title: string, width = 75): void {
		console.log("┌─ " + title + " " + "─".repeat(Math.max(0, width - title.length - 4)) + "┐");
	}

	/**
	 * Print subsection footer
	 */
	static subsectionEnd(width = 75): void {
		console.log("└" + "─".repeat(width - 2) + "┘\n");
	}

	/**
	 * Print a key-value pair with nice formatting
	 */
	static keyValue(key: string, value: string | number, indent = 0): void {
		const indentStr = " ".repeat(indent);
		const keyStr = key.padEnd(30);
		console.log(`${indentStr}${keyStr} ${value}`);
	}

	/**
	 * Print a metric with label and optional status indicator
	 */
	static metric(
		label: string,
		value: string | number,
		status?: "good" | "warning" | "bad",
		unit = ""
	): void {
		const statusIcon = status === "good" ? "✓" : status === "warning" ? "⚠" : status === "bad" ? "✗" : "";
		const statusText = status === "good" ? "Good" : status === "warning" ? "Fair" : status === "bad" ? "Low" : "";
		const statusDisplay = statusIcon ? `  ${statusIcon} ${statusText}` : "";
		console.log(`│  ${label.padEnd(28)} ${String(value).padStart(12)}${unit}${statusDisplay}`);
	}

	/**
	 * Print a table with headers and rows
	 */
	static table(columns: TableColumn[], rows: (string | number)[][]): void {
		// Print header
		let headerRow = "│  ";
		let separatorRow = "│  ";
		for (const col of columns) {
			const align = col.align || "left";
			const header = col.header.padEnd(col.width);
			headerRow += header + "  │  ";
			separatorRow += "─".repeat(col.width) + "  │  ";
		}
		console.log(headerRow);
		console.log(separatorRow);

		// Print rows
		for (const row of rows) {
			let rowStr = "│  ";
			for (let i = 0; i < columns.length; i++) {
				const col = columns[i];
				const align = col.align || "left";
				const value = String(row[i] || "");
				const padded = align === "right" ? value.padStart(col.width) : value.padEnd(col.width);
				rowStr += padded + "  │  ";
			}
			console.log(rowStr);
		}
	}

	/**
	 * Print a progress bar
	 */
	static progressBar(current: number, total: number, width = 50, label = ""): void {
		const percentage = total > 0 ? (current / total) * 100 : 0;
		const filled = Math.round((percentage / 100) * width);
		const empty = width - filled;
		const bar = "█".repeat(filled) + "░".repeat(empty);
		const labelStr = label ? `${label}: ` : "";
		console.log(`${labelStr}[${bar}] ${percentage.toFixed(1)}% (${current}/${total})`);
	}

	/**
	 * Print a distribution chart
	 */
	static distributionChart(
		buckets: Array<{ label: string; count: number; percentage: number }>,
		width = 50
	): void {
		const maxCount = Math.max(...buckets.map((b) => b.count));
		console.log("│  Range          Count      %      Distribution");
		console.log("│  " + "─".repeat(65));

		for (const bucket of buckets) {
			const barLength = maxCount > 0 ? Math.round((bucket.count / maxCount) * width) : 0;
			const bar = "█".repeat(barLength);
			const label = bucket.label.padEnd(13);
			const count = String(bucket.count).padStart(8);
			const pct = String(bucket.percentage.toFixed(1) + "%").padStart(6);
			console.log(`│  ${label}  ${count}  ${pct}  ${bar}`);
		}
	}

	/**
	 * Print a list with numbered items
	 */
	static numberedList(items: string[], indent = 0): void {
		const indentStr = " ".repeat(indent);
		items.forEach((item, index) => {
			console.log(`${indentStr}${(index + 1).toString().padStart(3)}. ${item}`);
		});
	}

	/**
	 * Print a warning message
	 */
	static warning(message: string): void {
		console.log(`\n⚠️  ${message}\n`);
	}

	/**
	 * Print an info message
	 */
	static info(message: string): void {
		console.log(`\nℹ️  ${message}\n`);
	}

	/**
	 * Print a success message
	 */
	static success(message: string): void {
		console.log(`\n✓ ${message}\n`);
	}

	/**
	 * Print an error message
	 */
	static error(message: string): void {
		console.log(`\n✗ ${message}\n`);
	}

	/**
	 * Format a number with thousand separators
	 */
	static formatNumber(num: number): string {
		return num.toLocaleString();
	}

	/**
	 * Format a percentage
	 */
	static formatPercent(value: number, total: number, decimals = 1): string {
		if (total === 0) return "0.0%";
		return ((value / total) * 100).toFixed(decimals) + "%";
	}

	/**
	 * Format a duration in minutes to human-readable
	 */
	static formatDuration(minutes: number): string {
		if (minutes < 60) {
			return `${minutes.toFixed(1)} min`;
		} else if (minutes < 1440) {
			return `${(minutes / 60).toFixed(1)} hours`;
		} else {
			return `${(minutes / 1440).toFixed(1)} days`;
		}
	}

	/**
	 * Format a date/time
	 */
	static formatDateTime(date: Date | string): string {
		const d = typeof date === "string" ? new Date(date) : date;
		return d.toLocaleString();
	}

	/**
	 * Format a relative time (e.g., "2 hours ago")
	 */
	static formatRelativeTime(date: Date | string): string {
		const d = typeof date === "string" ? new Date(date) : date;
		const now = new Date();
		const diffMs = now.getTime() - d.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMins / 60);
		const diffDays = Math.floor(diffHours / 24);

		if (diffMins < 1) return "just now";
		if (diffMins < 60) return `${diffMins} min ago`;
		if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
		if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
		return d.toLocaleDateString();
	}

	/**
	 * Print a summary box
	 */
	static summaryBox(title: string, items: Array<{ label: string; value: string | number }>): void {
		console.log("\n┌─ " + title + " " + "─".repeat(Math.max(0, 65 - title.length - 4)) + "┐");
		for (const item of items) {
			const label = item.label.padEnd(30);
			const value = String(item.value).padStart(20);
			console.log(`│  ${label}${value}  │`);
		}
		console.log("└" + "─".repeat(67) + "┘\n");
	}

	/**
	 * Print a horizontal rule
	 */
	static hr(width = 75): void {
		console.log("─".repeat(width));
	}
}

