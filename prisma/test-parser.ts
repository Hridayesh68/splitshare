import fs from 'fs';
import path from 'path';
import { parseCSV, validateCSVRows } from '../src/lib/csv-parser';
import { prisma, pool } from '../src/lib/prisma';

async function testParser() {
  console.log("--- Starting Parser Verification Test ---");

  // Fetch the first group in the database
  const group = await prisma.group.findFirst();
  if (!group) {
    console.error("No group found in the database. Please run seed script first.");
    process.exit(1);
  }
  console.log(`Using group: ${group.name} (${group.id})`);

  // Read CSV
  const csvPath = path.join(__dirname, '..', '..', 'expenses_export.csv');
  console.log(`Reading CSV from: ${csvPath}`);
  if (!fs.existsSync(csvPath)) {
    console.error("CSV file not found!");
    process.exit(1);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const rawRows = parseCSV(csvContent);
  console.log(`Parsed ${rawRows.length} raw rows.`);

  const { anomalies, validRows } = await validateCSVRows(rawRows, group.id);

  console.log(`\nDetected ${anomalies.length} anomalies:`);
  anomalies.forEach((a, i) => {
    console.log(`[Anomaly ${i+1}] Row ${a.rowNumber}: ${a.errorType} - ${a.description} (Suggested: ${a.suggestedResolution})`);
  });

  console.log(`\nValid rows after filtering out block-level errors: ${validRows.length}`);
  console.log("--- Parser Verification Test Complete ---");
}

testParser()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
