import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import express from "express";

import { logger } from "../common/logger";
import { Authorization, Intent } from "../common/types";
import { config } from "./config";
import * as jobs from "./jobs";
import { redis } from "./redis";
import { CachedSolution } from "./types";

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
  queues: [
    new BullMQAdapter(jobs.txListener.queue),
    new BullMQAdapter(jobs.txSolver.queue),
  ],
  serverAdapter: serverAdapter,
});

app.use(express.json());
app.use("/admin/bullmq", serverAdapter.getRouter());

app.get("/lives", (_req, res) => {
  return res.json({ message: "Yes" });
});

app.post("/intents", async (req, res) => {
  const intent = req.body.intent as Intent;
  await jobs.txSolver.addToQueue(intent);

  return res.json({ message: "Success" });
});

app.post("/authorizations", async (req, res) => {
  const uuid = req.body.uuid as string | undefined;
  const intent = req.body.intent as Intent | undefined;
  const approvalTxOrTxHash = req.body.approvalTxOrTxHash as string | undefined;
  const authorization = req.body.authorization as Authorization;

  if ((uuid && intent) || (!uuid && !intent)) {
    return res
      .status(400)
      .send({ error: "Must specify only one of `intent` or `uuid`" });
  }
  if (uuid && approvalTxOrTxHash) {
    return res.status(400).send({
      error: "Cannot specify `approvalTxOrTxHash` and `uuid` together",
    });
  }

  logger.info(
    "authorizations",
    JSON.stringify({
      msg: "Received authorization from matchmaker",
      uuid,
      intent,
      authorization,
      approvalTxOrTxHash,
    })
  );

  if (uuid) {
    const cachedSolution: CachedSolution | undefined = await redis
      .get(`solver:${uuid}`)
      .then((r) => (r ? JSON.parse(r) : undefined));
    if (!cachedSolution) {
      return res.status(400).send({ error: `Could not find uuid ${uuid}` });
    }

    await jobs.txSolver.addToQueue(cachedSolution.intent, {
      approvalTxOrTxHash: cachedSolution.approvalTxOrTxHash,
      existingSolution: cachedSolution.solution,
      authorization,
    });

    logger.info(
      "authorizations",
      JSON.stringify({
        msg: "Handled authorization from matchmaker",
        uuid,
        ...cachedSolution,
      })
    );
  } else if (intent) {
    await jobs.txSolver.addToQueue(intent, {
      approvalTxOrTxHash,
      authorization,
    });

    logger.info(
      "authorizations",
      JSON.stringify({
        msg: "Handled authorization from matchmaker",
        uuid,
        intent,
        authorization,
        approvalTxOrTxHash,
      })
    );
  }

  // TODO: Respond with signed transaction instead
  return res.json({ message: "Success" });
});

// Start app
app.listen(config.port, () => {});
