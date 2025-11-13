#!/usr/bin/env npx tsx

import { PostgreSQLManager } from "../features/database/PostgreSQLManager";

async function main() {
  const db = new PostgreSQLManager();
  await db.connect();

  const result = await db.query(
    `SELECT COUNT(*) as total,
            COUNT(embedding) as with_embedding
     FROM messages
     WHERE channel_id = $1
       AND created_at > NOW() - INTERVAL '24 hours'`,
    ['1254695279311978526']
  );

  console.log('Messages:', result.data?.[0]);

  await db.disconnect();
}

main().catch(console.error);
