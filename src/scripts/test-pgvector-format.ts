import { pgvector } from "../database/PostgreSQLManager.js";

const testArray = [1.1, 2.2, 3.3];
const formatted = pgvector.toSql(testArray);

console.log("Input array:", testArray);
console.log("pgvector.toSql() output:", formatted);
console.log("Type:", typeof formatted);
console.log("Length:", formatted.length);
