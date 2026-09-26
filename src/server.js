import "dotenv/config";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { KaggleClient } from "./kaggleClient.js";
import { registerKaggleTools } from "./tools.js";

const PORT = process.env.PORT || 3000;
const BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;

const kaggle = new KaggleClient({
  username: process.env.KAGGLE_USERNAME,
  key: process.env.KAGGLE_KEY,
});

const app = express();
app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok" }));

// Token-in-URL gate. Claude's custom-connector modal has no field for a
// custom Authorization header — only OAuth or fully open access — so the
// secret has to travel inside the connector URL itself as a query param.
// Anyone with the full URL (including ?token=...) can submit to your Kaggle
// competitions on your behalf, so treat that URL like a password.
app.use((req, res, next) => {
  if (!BEARER_TOKEN) return next(); // no token configured: open (local testing only)
  const auth = req.headers.authorization || "";
  const queryToken = req.query.token;
  if (auth === `Bearer ${BEARER_TOKEN}` || queryToken === BEARER_TOKEN) return next();
  res.status(401).json({ error: "Unauthorized" });
});

// Stateless mode: build a fresh McpServer + transport per request. Simpler
// and safer for a small personal server than juggling session IDs.
app.post("/mcp", async (req, res) => {
  try {
    const mcpServer = new McpServer({ name: "kaggle-mcp-server", version: "1.0.0" });
    registerKaggleTools(mcpServer, kaggle);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });

    res.on("close", () => {
      transport.close();
      mcpServer.close();
    });

    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// GET/DELETE are part of the Streamable HTTP spec for server-initiated
// notifications and session teardown; not needed in stateless mode.
app.get("/mcp", (req, res) => res.status(405).json({ error: "Method not allowed (stateless server)" }));
app.delete("/mcp", (req, res) => res.status(405).json({ error: "Method not allowed (stateless server)" }));

app.listen(PORT, () => {
  console.log(`Kaggle MCP server listening on port ${PORT}`);
});
