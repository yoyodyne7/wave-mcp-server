# wave-mcp-server

An MCP server that lets Claude (or any MCP client) work with [Wave](https://www.waveapps.com)
invoicing for one business: look up customers and invoices, create customers and draft
invoices, and approve, send and record payments behind a preview-then-confirm step.

> **Unofficial.** This project is not affiliated with, endorsed by or supported by Wave
> Financial. It uses Wave's public GraphQL API with a token you create yourself.

## Requirements

- Node.js 22 or later
- A Wave account and a Full Access Token from the Wave developer portal

## Setup

1. **Create a test business** in Wave (Wave recommends this as a sandbox) and add a customer,
   a product and a sales tax to it. Point the server at it until you trust the setup.
2. **Create an application and token:** in the [Wave developer portal](https://developer.waveapps.com)
   go to Manage Applications, create an application, then Create token. The token can see
   **every business** in your Wave account; treat it like a password.
3. **Find your business id:**
   ```bash
   WAVE_ACCESS_TOKEN=your-token npx -y @sdnly/wave-mcp-server --list-businesses
   ```
4. **Register with Claude Code:**
   ```bash
   claude mcp add wave \
     -e WAVE_ACCESS_TOKEN=your-token \
     -e WAVE_BUSINESS_ID=your-business-id \
     -- npx -y @sdnly/wave-mcp-server
   ```
   For Claude Desktop or another client, add the same command and environment variables to
   its MCP config:
   ```json
   {
     "mcpServers": {
       "wave": {
         "command": "npx",
         "args": ["-y", "@sdnly/wave-mcp-server"],
         "env": { "WAVE_ACCESS_TOKEN": "your-token", "WAVE_BUSINESS_ID": "your-business-id" }
       }
     }
   }
   ```
5. Ask Claude to run `wave_get_business` to confirm the connection.

To switch from the test business to the real one, change `WAVE_BUSINESS_ID` and restart your
client.

### Running from a clone

If you would rather not use npx, or want to keep the token out of your client's config:

```bash
git clone https://github.com/yoyodyne7/wave-mcp-server.git && cd wave-mcp-server
npm install && npm run build
cp .env.example .env && chmod 600 .env    # paste the token and business id into .env
node dist/index.js --list-businesses
claude mcp add wave -- node "$(pwd)/dist/index.js"
```

The server reads `.env` from the folder above `dist/`. If a value is set both there and in the
environment with different contents, it refuses to start rather than guess which one you meant.

## Tools

| Kind | Tools |
|---|---|
| Read | `wave_get_business`, `wave_list_customers`, `wave_get_customer`, `wave_list_invoices`, `wave_get_invoice`, `wave_list_products`, `wave_list_sales_taxes`, `wave_list_accounts` |
| Write | `wave_create_customer`, `wave_update_customer`, `wave_create_product`, `wave_create_invoice` (drafts only), `wave_update_invoice` (drafts only) |
| Gated | `wave_approve_invoice`, `wave_send_invoice`, `wave_mark_invoice_sent`, `wave_record_payment` |

Gated tools return a preview and a fingerprint on the first call and do nothing. They act only
when called again with `confirm: true` and that fingerprint, and refuse if the invoice changed
in between.

There are no delete tools. Deletions, payment edits, estimates and expenses stay in Wave.

## Security and privacy

Read this before pointing the server at real books.

- **The token is a master key.** A Wave Full Access Token can read and change every business
  in your Wave account, not just the one in `WAVE_BUSINESS_ID`, and it lasts for years. The
  one-business limit is enforced by this server, not by Wave; anything else that gets hold of
  the token has no such limit. Where the token lives:
  - With `claude mcp add -e` or a Desktop config, it is stored in plain text in that client's
    config file (for Claude Code, `~/.claude.json`).
  - With a clone, it is in `.env`. Keep that file `chmod 600` and out of git.

  Either way, any program running as your user can read it. If your computer is lost or
  compromised, revoke the token in the Wave developer portal (Manage Applications) first.
- **Your Wave data goes to your AI provider.** Everything a tool returns (customer names,
  emails, addresses, invoice amounts) becomes part of the conversation and is sent to
  whichever model your client uses. Check that this fits your privacy obligations to your
  own customers.
- **Your approval is the safety net.** Text the assistant reads elsewhere in a session (an
  email, a web page, a document) can try to instruct it to create, approve or send invoices.
  Keep every write and gated tool on "ask every time", and read the preview before approving
  a gated call. The preview step proves a preview was requested, not that you read it. If you
  allow-list tools to cut down prompts, allow-list only the eight read tools, never
  `mcp__wave__*` as a whole.
- **Pin the version.** `npx -y @sdnly/wave-mcp-server` runs the newest published release.
  For books you care about, pin one you have reviewed, e.g.
  `npx -y @sdnly/wave-mcp-server@0.1.1`, or run from a clone.
- The server talks only to Wave's API (`https://gql.waveapps.com/graphql/public`) over HTTPS.
  It sends no telemetry and writes nothing to disk, and it strips the token from error
  messages.

## Usage notes

- The server acts only on `WAVE_BUSINESS_ID`. No tool accepts a business id.
- Writes are never retried. If a write times out, check the invoice in Wave before retrying.
- Tax on invoice lines: omit `sales_tax_ids` to use the product's default taxes; pass `[]`
  for no tax (zero-rated or export clients).
- On "Wave rejected the access token", create a new token and update your configuration.

## Status

Tested against a Wave test business. `wave_send_invoice` (Wave emails the invoice to the
customer) has not yet been verified against a live send; treat it as experimental and try it
on a test business first.

## Development

```bash
npm test        # unit and contract tests (no network)
npm run build   # compile to dist/
```

Wave's schema is unversioned. If a tool starts returning "Wave rejected the request shape",
compare the query in `src/queries/` with the API Reference in the developer portal.

## License

MIT. See [LICENSE](LICENSE). Provided as is, without warranty: you are responsible for what it
does in your Wave account.
