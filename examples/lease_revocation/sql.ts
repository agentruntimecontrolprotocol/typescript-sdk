/** SQL classifier — node-sql-parser-backed in production. */

export interface StatementClass {
  op: "read" | "write" | "ddl";
  tables: ReadonlySet<string>;
}

export function classify(_sql: string): StatementClass {
  // Real version: parse_one(sql, "postgres") + Table walk for tables,
  // isinstance against Insert / Update / Delete / Merge / Create / Drop /
  // AlterTable for op.
  throw new Error("not implemented");
}
