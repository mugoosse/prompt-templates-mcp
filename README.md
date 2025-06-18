# Prompt Templates MCP Server

A Model Context Protocol (MCP) server for managing prompt templates with dynamic variable substitution. This server provides tools for saving, updating, retrieving, and managing reusable prompt templates with automatic variable extraction.

## Features

- **Dynamic Variable Extraction**: Automatically detects `{variable}` placeholders in templates
- **MCP Tools**: Full set of tools for template management accessible via MCP clients
- **REST API**: HTTP endpoints for integration with external applications
- **Persistent Storage**: Uses Cloudflare D1 database for reliable storage
- **Variable Substitution**: Render templates with provided input values

## MCP Tools

The server exposes the following MCP tools:

1. **`save_prompt_template`** - Save new templates with automatic input extraction
2. **`update_prompt_template`** - Modify existing templates  
3. **`delete_prompt_template`** - Remove templates
4. **`list_prompt_templates`** - View all saved templates
5. **`get_prompt_by_name`** - Retrieve and render templates with input values

### Example Usage

```typescript
// Save a template
await save_prompt_template({
  name: "greeting",
  template: "Hello my name is {firstName} {lastName}. What is my name?"
});
// Automatically extracts: firstName, lastName as required inputs

// Use the template
await get_prompt_by_name({
  name: "greeting",
  inputs: {
    firstName: "John",
    lastName: "Doe"
  }
});
// Returns: "Hello my name is John Doe. What is my name?"
```

## REST API Endpoints

- `GET /prompts` - List all templates
- `GET /prompts/:name` - Get a specific template
- `POST /prompts` - Create a new template
- `PUT /prompts/:name` - Update a template
- `DELETE /prompts/:name` - Delete a template

## Getting Started

This project uses the HONC stack (Hono + Cloudflare) with D1 database for storage.

### Project Structure

```
├── src
│   ├── index.ts          # MCP server & API endpoints
│   └── db
│       └── schema.ts     # Database schema for prompt templates
├── wrangler.toml         # Cloudflare Workers configuration
├── drizzle.config.ts     # Drizzle ORM configuration
├── package.json
└── tsconfig.json
```

### Local Development

Run the migrations and (optionally) seed the database:

```sh
# this is a convenience script that runs db:touch, db:generate, db:migrate, and db:seed
npm run db:setup
```

Run the development server:

```sh
npm run dev
```

As you iterate on the database schema, you'll need to generate a new migration file and apply it like so:

```sh
npm run db:generate
npm run db:migrate
```

### Deployment

Before deploying your worker to Cloudflare, ensure that you have a running D1 instance on Cloudflare to connect your worker to.

You can create a D1 instance by navigating to the `Workers & Pages` section and selecting `D1 SQL Database.`

Alternatively, you can create a D1 instance using the CLI:

```sh
npx wrangler d1 create <database-name>
```

After creating the database, update the `wrangler.toml` file with the database id.

```toml
[[d1_databases]]
binding = "DB"
database_name = "honc-d1-database"
database_id = "<database-id-you-just-created>"
migrations_dir = "drizzle/migrations"
```

Include the following information in a `.prod.vars` file:

```sh
CLOUDFLARE_D1_TOKEN="" # An API token with D1 edit permissions. You can create API tokens from your Cloudflare profile
CLOUDFLARE_ACCOUNT_ID="" # Find your Account id on the Workers & Pages overview (upper right)
CLOUDFLARE_DATABASE_ID="" # Find the database ID under workers & pages under D1 SQL Database and by selecting the created database
```

If you haven’t generated the latest migration files yet, run:
```shell
npm run db:generate
```

Afterwards, run the migration script for production:
```shell
npm run db:migrate:prod
```

Change the name of the project in `wrangler.toml` to something appropriate for your project:

```toml
name = "prompt-templates-mcp"
```

Finally, deploy your worker:

```shell 
npm run deploy
```

## Database Schema

The server uses a simple schema to store prompt templates:

```typescript
promptTemplates {
  id: integer (primary key)
  name: text (unique)
  template: text
  inputs: text (JSON array of required variables)
  createdAt: text
  updatedAt: text
}
```

## Setting up the MCP Server in Claude Desktop

After deploying your server, follow these steps to connect it to Claude Desktop:

1. **Open Claude Desktop Configuration**
   - On macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - On Windows: `%APPDATA%\Claude\claude_desktop_config.json`

2. **Add your MCP server to the configuration file:**

```json
{
  "mcpServers": {
    "prompt-templates": {
      "command": "npx",
      "args": [
        "@modelcontextprotocol/server-fetch",
        "https://YOUR-WORKER-URL/mcp"
      ]
    }
  }
}
```

Replace `YOUR-WORKER-URL` with your deployed Cloudflare Worker URL.

3. **Restart Claude Desktop** completely (quit and reopen the application)

4. **Verify the connection** by looking for the 🔌 icon in Claude Desktop, which indicates MCP servers are connected

## Testing Your MCP Server

Once connected, you can use these tools in your conversations:

**Save a template:**
```
Use the save_prompt_template tool to save this template:
- Name: "greeting"
- Description: "A personalized greeting template"
- Template: "Hello my name is {firstName} {lastName}. What is my name?"
```

**List your templates:**
```
Use the list_prompt_templates tool to show me all saved templates
```

**Use a template:**
```
Use the get_prompt_by_name tool with:
- Name: "greeting"
- Inputs: {"firstName": "John", "lastName": "Doe"}
```

The server will automatically extract variables from any template you save (like `{firstName}` and `{lastName}` from your example) and make them available as structured inputs.

## Built With

- [Hono](https://hono.dev/) - Web framework
- [Cloudflare Workers](https://workers.cloudflare.com/) - Serverless platform
- [Cloudflare D1](https://developers.cloudflare.com/d1/) - SQLite database
- [Drizzle ORM](https://orm.drizzle.team/) - TypeScript ORM
- [Model Context Protocol](https://modelcontextprotocol.io/) - AI tool integration protocol


