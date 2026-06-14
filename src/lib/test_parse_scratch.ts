import { parseCSV } from './csv-parser';

const csv = `date\tdescription\tpaid_by\tamount\tcurrency\tsplit_type\tsplit_with\tsplit_details\tnotes
01-02-2026\tFebruary rent\tAisha\t48000\tINR\tequal\tAisha;Rohan;Priya;Meera\t\t`;

const rows = parseCSV(csv);
console.log("Parsed rows:", JSON.stringify(rows, null, 2));
