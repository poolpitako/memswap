import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import express from "express";

import { logger } from "../common/logger";
import { Intent } from "../common/types";
import { config } from "./config";
import * as jobs from "./jobs";
import { processSolution } from "./solutions";

// Log unhandled errors
process.on("unhandledRejection", (error) => {
  logger.error(
    "process",
    JSON.stringify({ data: `Unhandled rejection: ${error}` })
  );
});

// Initialize app
const app = express();

// Initialize BullMQ dashboard
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/bullmq");
createBullBoard({
  queues: [new BullMQAdapter(jobs.signatureRelease.queue)],
  serverAdapter: serverAdapter,
});

app.use(express.json());
app.use("/admin/bullmq", serverAdapter.getRouter());

app.get("/lives", (_, res) => {
  return res.json({ message: "yes" });
});

app.post("/intents/private", async (req, res) => {
  const { approvalTxOrTxHash, intent } = req.body as {
    approvalTxOrTxHash?: string;
    intent: Intent;
  };

  if (!config.knownSolvers.length) {
    return res.status(400).json({ error: "No known solvers" });
  }

  // Send to a single solver
  await jobs.signatureRelease.submitDirectlyToSolver(
    config.knownSolvers.slice(0, 1).map((s) => {
      const [address, baseUrl] = s.split(" ");
      return { address, baseUrl };
    }),
    intent,
    approvalTxOrTxHash
  );

  return res.json({ message: "Success" });
});

app.post("/intents/public", async (req, res) => {
  const { approvalTxOrTxHash, intent } = req.body as {
    approvalTxOrTxHash?: string;
    intent: Intent;
  };

  if (!config.knownSolvers.length) {
    return res.status(400).json({ error: "No known solvers" });
  }

  // Send to all solvers
  await jobs.signatureRelease.submitDirectlyToSolver(
    config.knownSolvers.map((s) => {
      const [address, baseUrl] = s.split(" ");
      return { address, baseUrl };
    }),
    intent,
    approvalTxOrTxHash
  );

  // TODO: Relay via bloxroute

  return res.json({ message: "Success" });
});

app.post("/solutions", async (req, res) => {
  const { uuid, baseUrl, intent, txs } = req.body as {
    uuid: string;
    baseUrl: string;
    intent: Intent;
    txs: string[];
  };

  if (!uuid || !baseUrl || !intent || !txs?.length) {
    return res.status(400).json({ message: "Invalid parameters" });
  }

  const result = await processSolution(uuid, baseUrl, intent, txs);
  if (result.status === "error") {
    return res.status(400).json({ error: result.error });
  } else if (result.status === "success") {
    return res.status(200).json({
      message: "Success",
    });
  }

  return res.json({ message: "success" });
});

// Start app
app.listen(config.port, () => {});
