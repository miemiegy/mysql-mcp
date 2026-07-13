# miemiegy-mysql

A Model Context Protocol (MCP) server that exposes MySQL operations as tools.

## Features

- Query data with `SELECT` / `SHOW`
- Execute write SQL (`INSERT`, `UPDATE`, `DELETE`, `CREATE`, `DROP`, `ALTER`)
- List tables and describe table structures
- High-level tools: `create_table`, `insert`, `update`, `delete`
- Configurable via environment variables

## Install

```bash
npm install -g miemiegy-mysql
```

Or run directly with `npx`:

```bash
npx miemiegy-mysql
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MYSQL_HOST` | `localhost` | MySQL host |
| `MYSQL_PORT` | `3306` | MySQL port |
| `MYSQL_USER` | `root` | MySQL user |
| `MYSQL_PASSWORD` | `root123456` | MySQL password |
| `MYSQL_DATABASE` | `mydb` | Default database |
| `MYSQL_ALLOWED_OPERATIONS` | `select,insert,update,explain,create,alter` | Comma-separated allowed operations |

### Permission Control

By default, destructive operations (`delete`, `drop`, `truncate`) are **disabled**. You can customize permissions with `MYSQL_ALLOWED_OPERATIONS`:

```bash
# Read-only
MYSQL_ALLOWED_OPERATIONS=select,explain

# Default (no delete/drop/truncate)
MYSQL_ALLOWED_OPERATIONS=select,insert,update,explain,create,alter

# Full access
MYSQL_ALLOWED_OPERATIONS=select,insert,update,delete,explain,create,drop,alter,truncate
```

## Usage with Claude Desktop

Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "mysql": {
      "command": "npx",
      "args": ["-y", "miemiegy-mysql"],
      "env": {
        "MYSQL_HOST": "localhost",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "root",
        "MYSQL_PASSWORD": "root123456",
        "MYSQL_DATABASE": "mydb"
      }
    }
  }
}
```

## Available Tools

- `mysql_query`
- `mysql_execute`
- `mysql_list_tables`
- `mysql_describe_table`
- `mysql_create_table`
- `mysql_insert`
- `mysql_update`
- `mysql_delete`
- `mysql_list_datasources`

## Multi-Datasource Support

Configure multiple datasources with `MYSQL_DATASOURCES` (JSON). Every tool accepts an optional `datasource` argument.

```bash
MYSQL_DATASOURCES='{
  "prod": {"host": "prod.db", "port": 3306, "user": "app", "password": "secret", "database": "prod_db"},
  "dev": {"host": "localhost", "port": 3307, "user": "root", "password": "devpass", "database": "dev_db"}
}'
```

Usage:

```json
{
  "datasource": "prod",
  "sql": "SELECT * FROM users"
}
```

## Example

```bash
MYSQL_HOST=localhost MYSQL_USER=root MYSQL_PASSWORD=root123456 MYSQL_DATABASE=mydb npx miemiegy-mysql
```

## License

MIT
