#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import mysql, { RowDataPacket, ResultSetHeader } from "mysql2/promise";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface DatasourceConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

// ---------------------------------------------------------------------------
// Default datasource (backward compatible)
// Named "test" so the default environment variables act as the test database.
// ---------------------------------------------------------------------------
const defaultConfig: DatasourceConfig = {
  host: process.env.MYSQL_HOST || "localhost",
  port: parseInt(process.env.MYSQL_PORT || "3306", 10),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "root123456",
  database: process.env.MYSQL_DATABASE || "mydb",
};

// ---------------------------------------------------------------------------
// Multi-datasource configuration
// Example:
// MYSQL_DATASOURCES='{"uat":{"host":"uat.db","port":3306,"user":"app","password":"xxx","database":"uat_db"}}'
// ---------------------------------------------------------------------------
const datasources: Map<string, DatasourceConfig> = new Map();
datasources.set("test", defaultConfig);

if (process.env.MYSQL_DATASOURCES) {
  try {
    const parsed = JSON.parse(process.env.MYSQL_DATASOURCES) as Record<string, Partial<DatasourceConfig>>;
    for (const [name, cfg] of Object.entries(parsed)) {
      if (name === "test") continue; // reserved for the default config
      datasources.set(name, {
        host: cfg.host || defaultConfig.host,
        port: cfg.port || defaultConfig.port,
        user: cfg.user || defaultConfig.user,
        password: cfg.password || defaultConfig.password,
        database: cfg.database || defaultConfig.database,
      });
    }
  } catch (err) {
    console.error("Failed to parse MYSQL_DATASOURCES:", err);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Permission control
// ---------------------------------------------------------------------------
const allowedOperations = new Set(
  (process.env.MYSQL_ALLOWED_OPERATIONS || "select,insert,update,explain,create,alter")
    .split(",")
    .map((op) => op.trim().toLowerCase())
    .filter(Boolean)
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getDatasource(name?: string): DatasourceConfig {
  const key = name || "test";
  const ds = datasources.get(key);
  if (!ds) {
    throw new Error(
      `Unknown datasource '${key}'. Available datasources: ${Array.from(datasources.keys()).join(", ")}`
    );
  }
  return ds;
}

function getPool(datasource?: string, database?: string) {
  const cfg = getDatasource(datasource);
  return mysql.createPool({
    ...cfg,
    database: database || cfg.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
  });
}

function sanitizeIdentifier(name: string): string {
  if (!name || typeof name !== "string") {
    throw new Error("Identifier must be a non-empty string");
  }
  const stripped = name.replace(/^`/, "").replace(/`$/, "");
  if (!/^[a-zA-Z0-9_]+$/.test(stripped)) {
    throw new Error(`Invalid identifier: ${name}`);
  }
  return `\`${stripped}\``;
}

function checkOperation(operation: string): void {
  if (!allowedOperations.has(operation.toLowerCase())) {
    throw new Error(
      `Operation '${operation}' is not allowed. Allowed operations: ${Array.from(allowedOperations).join(", ")}`
    );
  }
}

function detectSqlOperation(sql: string): string {
  const trimmed = sql.trim();
  const firstToken = trimmed.split(/\s+/)[0].toLowerCase();

  switch (firstToken) {
    case "select":
      return "select";
    case "explain":
      return "explain";
    case "insert":
    case "replace":
      return "insert";
    case "update":
      return "update";
    case "delete":
      return "delete";
    case "create":
      return "create";
    case "drop":
      return "drop";
    case "alter":
      return "alter";
    case "truncate":
      return "truncate";
    default:
      return firstToken;
  }
}

const datasourceProperty = {
  type: "string",
  description: "Datasource name. Uses 'test' if omitted.",
};

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    name: "mysql_query",
    description: "Execute a read-only SELECT, SHOW, or EXPLAIN query and return JSON results.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "A SELECT, SHOW, or EXPLAIN SQL statement" },
        database: { type: "string", description: "Optional database name" },
        datasource: datasourceProperty,
      },
      required: ["sql"],
    },
  },
  {
    name: "mysql_execute",
    description: "Execute a write SQL statement (INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "A SQL statement" },
        database: { type: "string", description: "Optional database name" },
        datasource: datasourceProperty,
      },
      required: ["sql"],
    },
  },
  {
    name: "mysql_list_tables",
    description: "List all tables in the current or specified database.",
    inputSchema: {
      type: "object",
      properties: {
        database: { type: "string", description: "Optional database name" },
        datasource: datasourceProperty,
      },
    },
  },
  {
    name: "mysql_describe_table",
    description: "Show the structure of a table.",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name" },
        database: { type: "string", description: "Optional database name" },
        datasource: datasourceProperty,
      },
      required: ["table"],
    },
  },
  {
    name: "mysql_create_table",
    description: "Create a new table from a column definition object.",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name" },
        columns: {
          type: "object",
          description: "Map of column name to column definition",
          additionalProperties: { type: "string" },
        },
        database: { type: "string", description: "Optional database name" },
        datasource: datasourceProperty,
      },
      required: ["table", "columns"],
    },
  },
  {
    name: "mysql_insert",
    description: "Insert a single row into a table.",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name" },
        data: {
          type: "object",
          description: "Column-value pairs",
          additionalProperties: {},
        },
        database: { type: "string", description: "Optional database name" },
        datasource: datasourceProperty,
      },
      required: ["table", "data"],
    },
  },
  {
    name: "mysql_update",
    description: "Update rows in a table.",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name" },
        data: {
          type: "object",
          description: "Column-value pairs to update",
          additionalProperties: {},
        },
        where: { type: "string", description: "WHERE clause" },
        database: { type: "string", description: "Optional database name" },
        datasource: datasourceProperty,
      },
      required: ["table", "data", "where"],
    },
  },
  {
    name: "mysql_delete",
    description: "Delete rows from a table.",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name" },
        where: { type: "string", description: "WHERE clause" },
        database: { type: "string", description: "Optional database name" },
        datasource: datasourceProperty,
      },
      required: ["table", "where"],
    },
  },
  {
    name: "mysql_list_datasources",
    description: "List all configured datasource names and their hosts (passwords hidden).",
    inputSchema: {
      type: "object",
    },
  },
];

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------
const server = new Server(
  {
    name: "miemiegy-mysql",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "mysql_query": {
        const sql = String(args?.sql || "").trim();
        const op = detectSqlOperation(sql);

        if (op !== "select" && op !== "show" && op !== "explain") {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: "Only SELECT / SHOW / EXPLAIN queries are allowed with mysql_query. Use mysql_execute for writes." }),
              },
            ],
          };
        }
        checkOperation(op);

        const pool = getPool(args?.datasource as string | undefined, args?.database as string | undefined);
        const [rows] = await pool.query<RowDataPacket[]>(sql);
        await pool.end();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ rows, row_count: rows.length }, null, 2),
            },
          ],
        };
      }

      case "mysql_execute": {
        const sql = String(args?.sql || "").trim();
        const op = detectSqlOperation(sql);
        checkOperation(op);

        const pool = getPool(args?.datasource as string | undefined, args?.database as string | undefined);
        const [result] = await pool.query<ResultSetHeader>(sql);
        await pool.end();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  affected_rows: result.affectedRows,
                  last_insert_id: result.insertId,
                  message: "OK",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "mysql_list_tables": {
        const ds = getDatasource(args?.datasource as string | undefined);
        const db = (args?.database as string) || ds.database;
        const pool = getPool(args?.datasource as string | undefined);
        const [rows] = await pool.query<RowDataPacket[]>(
          `SHOW TABLES FROM ${sanitizeIdentifier(db)}`
        );
        await pool.end();
        const key = rows.length > 0 ? Object.keys(rows[0])[0] : "Tables_in_db";
        const tables = rows.map((r) => r[key]);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ datasource: args?.datasource || "test", database: db, tables }, null, 2),
            },
          ],
        };
      }

      case "mysql_describe_table": {
        const table = String(args?.table || "");
        const pool = getPool(args?.datasource as string | undefined, args?.database as string | undefined);
        const [rows] = await pool.query<RowDataPacket[]>(
          `DESCRIBE ${sanitizeIdentifier(table)}`
        );
        await pool.end();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ table, columns: rows }, null, 2),
            },
          ],
        };
      }

      case "mysql_create_table": {
        checkOperation("create");
        const table = String(args?.table || "");
        const columns = args?.columns as Record<string, string>;
        if (!columns || Object.keys(columns).length === 0) {
          throw new Error("columns cannot be empty");
        }
        const parts = Object.entries(columns).map(
          ([col, def]) => `${sanitizeIdentifier(col)} ${def}`
        );
        const sql = `CREATE TABLE IF NOT EXISTS ${sanitizeIdentifier(table)} (\n  ${parts.join(",\n  ")}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
        const pool = getPool(args?.datasource as string | undefined, args?.database as string | undefined);
        const [result] = await pool.query<ResultSetHeader>(sql);
        await pool.end();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { affected_rows: result.affectedRows, message: "OK" },
                null,
                2
              ),
            },
          ],
        };
      }

      case "mysql_insert": {
        checkOperation("insert");
        const table = String(args?.table || "");
        const data = args?.data as Record<string, unknown>;
        if (!data || Object.keys(data).length === 0) {
          throw new Error("data cannot be empty");
        }
        const columns = Object.keys(data).map(sanitizeIdentifier);
        const placeholders = Object.keys(data).map(() => "?").join(", ");
        const sql = `INSERT INTO ${sanitizeIdentifier(table)} (${columns.join(", ")}) VALUES (${placeholders})`;
        const pool = getPool(args?.datasource as string | undefined, args?.database as string | undefined);
        const [result] = await pool.query<ResultSetHeader>(sql, Object.values(data));
        await pool.end();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  affected_rows: result.affectedRows,
                  last_insert_id: result.insertId,
                  message: "Inserted successfully",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "mysql_update": {
        checkOperation("update");
        const table = String(args?.table || "");
        const data = args?.data as Record<string, unknown>;
        const where = String(args?.where || "");
        if (!data || Object.keys(data).length === 0) {
          throw new Error("data cannot be empty");
        }
        if (!where) {
          throw new Error("where clause is required");
        }
        const setClause = Object.keys(data)
          .map((c) => `${sanitizeIdentifier(c)} = ?`)
          .join(", ");
        const sql = `UPDATE ${sanitizeIdentifier(table)} SET ${setClause} WHERE ${where}`;
        const pool = getPool(args?.datasource as string | undefined, args?.database as string | undefined);
        const [result] = await pool.query<ResultSetHeader>(sql, Object.values(data));
        await pool.end();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { affected_rows: result.affectedRows, message: "Updated successfully" },
                null,
                2
              ),
            },
          ],
        };
      }

      case "mysql_delete": {
        checkOperation("delete");
        const table = String(args?.table || "");
        const where = String(args?.where || "");
        if (!where) {
          throw new Error("where clause is required");
        }
        const sql = `DELETE FROM ${sanitizeIdentifier(table)} WHERE ${where}`;
        const pool = getPool(args?.datasource as string | undefined, args?.database as string | undefined);
        const [result] = await pool.query<ResultSetHeader>(sql);
        await pool.end();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { affected_rows: result.affectedRows, message: "Deleted successfully" },
                null,
                2
              ),
            },
          ],
        };
      }

      case "mysql_list_datasources": {
        const list = Array.from(datasources.entries()).map(([name, cfg]) => ({
          name,
          host: cfg.host,
          port: cfg.port,
          user: cfg.user,
          database: cfg.database,
        }));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ datasources: list }, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: error.message || String(error) }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
