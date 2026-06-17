import express from "express";
import { createEntitlementProxy } from "./entitlement-proxy.js";
import { createEnforcementProxy } from "./enforcement-proxy.js";
import { createConnectorGateway } from "./connector-gateway.js";

const PORT = parseInt(process.env.PORT || "3004", 10);

const app = express();
app.use(express.json());
app.use("/api/core", createEnforcementProxy());
app.use("/api/runtime/internal", createEntitlementProxy());
app.use("/api/runtime/mcp-sdk", createConnectorGateway());

app.listen(PORT, () => {
  console.log(`Management server listening on port ${PORT}`);
});