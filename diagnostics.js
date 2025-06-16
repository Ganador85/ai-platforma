import pool from "./db.js";

// Pakeisk į konkretų conversation_id, kurį nori testuoti:
const TEST_CONVERSATION_ID = 1;

const runDiagnostics = async () => {
  try {
    console.log(`🧪 Tikriname pokalbį ID: ${TEST_CONVERSATION_ID}`);

    // 1. Žinučių skaičius
    const countRes = await pool.query(
      "SELECT COUNT(*) FROM messages WHERE conversation_id = $1",
      [TEST_CONVERSATION_ID]
    );
    console.log(`📨 Žinučių kiekis: ${countRes.rows[0].count}`);

    // 2. Gauti paskutines žinutes
    const messagesRes = await pool.query(
      `SELECT id, role, 
              CASE WHEN content IS NULL THEN '❌' ELSE '✅' END as has_content,
              CASE WHEN embedding IS NULL THEN '❌' ELSE '✅' END as has_embedding,
              created_at
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [TEST_CONVERSATION_ID]
    );

    console.log("\n🧾 Paskutinės 10 žinučių:");
    messagesRes.rows.forEach((row) => {
      console.log(
        `#${row.id} | ${row.role.toUpperCase()} | content: ${row.has_content}, embedding: ${row.has_embedding} | ${row.created_at}`
      );
    });

    // 3. Visoje lentelėje ar yra null content
    const nulls = await pool.query(
      "SELECT COUNT(*) FROM messages WHERE content IS NULL"
    );
    if (parseInt(nulls.rows[0].count) > 0) {
      console.warn(`⚠️ YRA ${nulls.rows[0].count} žinučių su NULL content!`);
    } else {
      console.log("✅ Visi content laukeliai yra užpildyti.");
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Diagnostikos klaida:", error.message);
    process.exit(1);
  }
};

runDiagnostics();
