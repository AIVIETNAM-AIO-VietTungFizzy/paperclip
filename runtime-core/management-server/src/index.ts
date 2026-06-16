import express from "express";
import { createEntitlementProxy } from "./entitlement-proxy.js";

const PORT = parseInt(process.env.PORT || "3004", 10);

const app = express();
app.use(express.json());
app.use("/api/runtime/internal", createEntitlementProxy());

app.listen(PORT, () => {
  console.log(`Management server listening on port ${PORT}`);
});