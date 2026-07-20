# miemiegy-mysql

[English](README.md)

[![GitHub](https://img.shields.io/badge/GitHub-miemiegy%2Fmysql--mcp-181717?logo=github)](https://github.com/miemiegy/mysql-mcp)

一个基于 Model Context Protocol（MCP）的服务端，把 MySQL 操作封装成可用的工具。

## 功能特性

- 执行 `SELECT` / `SHOW` 查询数据
- 执行写入型 SQL（`INSERT`、`UPDATE`、`DELETE`、`CREATE`、`DROP`、`ALTER`）
- 列出表、查看表结构
- 提供高级工具：`create_table`、`insert`、`update`、`delete`
- 通过环境变量进行配置

## 安装

```bash
npm install -g miemiegy-mysql
```

也可以直接用 `npx` 运行：

```bash
npx miemiegy-mysql
```

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `MYSQL_HOST` | `localhost` | MySQL 主机地址 |
| `MYSQL_PORT` | `3306` | MySQL 端口 |
| `MYSQL_USER` | `root` | MySQL 用户名 |
| `MYSQL_PASSWORD` | `root123456` | MySQL 密码 |
| `MYSQL_DATABASE` | `mydb` | 默认数据库 |
| `MYSQL_ALLOWED_OPERATIONS` | `select,insert,update,explain,create,alter` | 允许的操作列表，用逗号分隔 |

### 权限控制

默认情况下，破坏性操作（`delete`、`drop`、`truncate`）是**禁用**的。可以通过 `MYSQL_ALLOWED_OPERATIONS` 自定义权限：

```bash
# 只读
MYSQL_ALLOWED_OPERATIONS=select,explain

# 默认（无 delete/drop/truncate）
MYSQL_ALLOWED_OPERATIONS=select,insert,update,explain,create,alter

# 完全权限
MYSQL_ALLOWED_OPERATIONS=select,insert,update,delete,explain,create,drop,alter,truncate
```

## 在 Claude Desktop 中使用

把以下内容添加到 Claude Desktop 的配置中：

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

## 可用工具

- `mysql_query`
- `mysql_execute`
- `mysql_list_tables`
- `mysql_describe_table`
- `mysql_create_table`
- `mysql_insert`
- `mysql_update`
- `mysql_delete`
- `mysql_list_datasources`

## 多数据源支持

可以通过 `MYSQL_DATASOURCES`（JSON 格式）配置多个数据源。每个工具都可以传入可选的 `datasource` 参数。

```bash
MYSQL_DATASOURCES='{
  "prod": {"host": "prod.db", "port": 3306, "user": "app", "password": "secret", "database": "prod_db"},
  "dev": {"host": "localhost", "port": 3307, "user": "root", "password": "devpass", "database": "dev_db"}
}'
```

使用方式：

```json
{
  "datasource": "prod",
  "sql": "SELECT * FROM users"
}
```

## 示例

```bash
MYSQL_HOST=localhost MYSQL_USER=root MYSQL_PASSWORD=root123456 MYSQL_DATABASE=mydb npx miemiegy-mysql
```

## 许可证

MIT
