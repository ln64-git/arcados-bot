import { PostgreSQLManager } from "../features/database/PostgreSQLManager";

async function getSampleUsers() {
	const db = new PostgreSQLManager();
	await db.connect();

	const result = await db.query(
		"SELECT user_id, display_name, username FROM members WHERE guild_id = $1 AND active = true LIMIT 5",
		["1254694808228986912"]
	);

	console.log("Sample users:");
	for (const user of result.data || []) {
		console.log(
			`  - ${user.user_id}: ${user.display_name} (@${user.username})`
		);
	}

	await db.disconnect();
}

getSampleUsers();
