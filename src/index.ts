#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import mysql, { RowDataPacket, ResultSetHeader } from "mysql2/promise";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------
interface DatasourceConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

// ---------------------------------------------------------------------------
// 默认数据源（向后兼容）
// 命名为 "test"，这样默认的环境变量就相当于 test 数据库的配置。
// ---------------------------------------------------------------------------
const defaultConfig: DatasourceConfig = {
  host: process.env.MYSQL_HOST || "localhost",
  port: parseInt(process.env.MYSQL_PORT || "3306", 10),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "root123456",
  database: process.env.MYSQL_DATABASE || "mydb",
};

// ---------------------------------------------------------------------------
// 多数据源配置
// 示例：
// MYSQL_DATASOURCES='{"uat":{"host":"uat.db","port":3306,"user":"app","password":"xxx","database":"uat_db"}}'
// ---------------------------------------------------------------------------
const datasources: Map<string, DatasourceConfig> = new Map();
datasources.set("test", defaultConfig);

if (process.env.MYSQL_DATASOURCES) {
  try {
    const parsed = JSON.parse(process.env.MYSQL_DATASOURCES) as Record<string, Partial<DatasourceConfig>>;
    for (const [name, cfg] of Object.entries(parsed)) {
      if (name === "test") continue; // "test" 保留给默认配置
      datasources.set(name, {
        host: cfg.host || defaultConfig.host,
        port: cfg.port || defaultConfig.port,
        user: cfg.user || defaultConfig.user,
        password: cfg.password || defaultConfig.password,
        database: cfg.database || defaultConfig.database,
      });
    }
  } catch (err) {
    console.error("解析 MYSQL_DATASOURCES 失败:", err);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 权限控制
// ---------------------------------------------------------------------------
const allowedOperations = new Set(
  (process.env.MYSQL_ALLOWED_OPERATIONS || "select,insert,update,explain,create,alter")
    .split(",")
    .map((op) => op.trim().toLowerCase())
    .filter(Boolean)
);

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------
function getDatasource(name?: string): DatasourceConfig {
  const key = name || "test";
  const ds = datasources.get(key);
  if (!ds) {
    throw new Error(
      `未知数据源 '${key}'。可用数据源：${Array.from(datasources.keys()).join(", ")}`
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
    throw new Error("标识符必须是非空字符串");
  }
  const stripped = name.replace(/^`/, "").replace(/`$/, "");
  if (!/^[a-zA-Z0-9_]+$/.test(stripped)) {
    throw new Error(`非法标识符：${name}`);
  }
  return `\`${stripped}\``;
}

function checkOperation(operation: string): void {
  if (!allowedOperations.has(operation.toLowerCase())) {
    throw new Error(
      `操作 '${operation}' 未被允许。允许的操作：${Array.from(allowedOperations).join(", ")}`
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
  description: "数据源名称。如果省略，则使用 'test'。",
};

// ---------------------------------------------------------------------------
// 工具定义
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    name: "mysql_query",
    description: "执行只读的 SELECT、SHOW 或 EXPLAIN 查询，并返回 JSON 结果。",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "一条 SELECT、SHOW 或 EXPLAIN SQL 语句" },
        database: { type: "string", description: "可选的数据库名称" },
        datasource: datasourceProperty,
      },
      required: ["sql"],
    },
  },
  {
    name: "mysql_execute",
    description: "执行写入型 SQL 语句（INSERT、UPDATE、DELETE、CREATE、DROP、ALTER 等）。",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "一条 SQL 语句" },
        database: { type: "string", description: "可选的数据库名称" },
        datasource: datasourceProperty,
      },
      required: ["sql"],
    },
  },
  {
    name: "mysql_list_tables",
    description: "列出当前或指定数据库中的所有表。",
    inputSchema: {
      type: "object",
      properties: {
        database: { type: "string", description: "可选的数据库名称" },
        datasource: datasourceProperty,
      },
    },
  },
  {
    name: "mysql_describe_table",
    description: "查看表结构。",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "表名" },
        database: { type: "string", description: "可选的数据库名称" },
        datasource: datasourceProperty,
      },
      required: ["table"],
    },
  },
  {
    name: "mysql_create_table",
    description: "根据列定义对象创建新表。",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "表名" },
        columns: {
          type: "object",
          description: "列名到列定义的映射",
          additionalProperties: { type: "string" },
        },
        database: { type: "string", description: "可选的数据库名称" },
        datasource: datasourceProperty,
      },
      required: ["table", "columns"],
    },
  },
  {
    name: "mysql_insert",
    description: "向表中插入单行数据。",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "表名" },
        data: {
          type: "object",
          description: "列值对",
          additionalProperties: {},
        },
        database: { type: "string", description: "可选的数据库名称" },
        datasource: datasourceProperty,
      },
      required: ["table", "data"],
    },
  },
  {
    name: "mysql_update",
    description: "更新表中的数据。",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "表名" },
        data: {
          type: "object",
          description: "要更新的列值对",
          additionalProperties: {},
        },
        where: { type: "string", description: "WHERE 子句" },
        database: { type: "string", description: "可选的数据库名称" },
        datasource: datasourceProperty,
      },
      required: ["table", "data", "where"],
    },
  },
  {
    name: "mysql_delete",
    description: "删除表中的数据。",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "表名" },
        where: { type: "string", description: "WHERE 子句" },
        database: { type: "string", description: "可选的数据库名称" },
        datasource: datasourceProperty,
      },
      required: ["table", "where"],
    },
  },
  {
    name: "mysql_list_datasources",
    description: "列出所有已配置的数据源名称及其主机信息（密码隐藏）。",
    inputSchema: {
      type: "object",
    },
  },
];

// ---------------------------------------------------------------------------
// 服务端初始化
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
                text: JSON.stringify({ error: "mysql_query 只允许 SELECT / SHOW / EXPLAIN 查询，写入操作请使用 mysql_execute。" }),
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
                  message: "执行成功",
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
          throw new Error("columns 不能为空");
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
                { affected_rows: result.affectedRows, message: "建表成功" },
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
          throw new Error("data 不能为空");
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
                  message: "插入成功",
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
          throw new Error("data 不能为空");
        }
        if (!where) {
          throw new Error("必须提供 where 子句");
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
                { affected_rows: result.affectedRows, message: "更新成功" },
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
          throw new Error("必须提供 where 子句");
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
                { affected_rows: result.affectedRows, message: "删除成功" },
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
        throw new Error(`未知工具：${name}`);
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
// 启动服务
// ---------------------------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("致命错误：", error);
  process.exit(1);
});
