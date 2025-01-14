import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { JsonRpcProvider } from "@ethersproject/providers";
import express from "express";
import cors from "cors";

import { logger } from "../common/logger";
import { Authorization, IntentERC20, IntentERC721 } from "../common/types";
import { config } from "./config";
import * as jobs from "./jobs";
import { redis } from "./redis";
import { CachedSolutionERC20, CachedSolutionERC721 } from "./types";

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
    new BullMQAdapter(jobs.inventoryManager.queue),
    new BullMQAdapter(jobs.txListener.queue),
    new BullMQAdapter(jobs.txSolverERC20.queue),
    new BullMQAdapter(jobs.txSolverERC721.queue),
  ],
  serverAdapter: serverAdapter,
});

app.use(cors());
app.use(express.json());
app.use("/admin/bullmq", serverAdapter.getRouter());

// Common

app.get("/lives", (_req, res) => {
  return res.json({ message: "Yes" });
});

app.post("/tx-listener", async (req, res) => {
  const txHash = req.body.txHash as string;

  const provider = new JsonRpcProvider(config.jsonUrl);
  const tx = await provider.getTransaction(txHash);

  await jobs.txListener.addToQueue({
    to: tx.to ?? null,
    input: tx.data,
    hash: txHash,
  });

  return res.json({ message: "Success" });
});

app.post("/inventory-manager", async (req, res) => {
  const address = req.body.address as string;

  await jobs.inventoryManager.addToQueue(address, true);

  return res.json({ message: "Success" });
});

// ERC20

app.post("/erc20/intents", async (req, res) => {
  const intent = req.body.intent as IntentERC20;
  await jobs.txSolverERC20.addToQueue(intent);

  return res.json({ message: "Success" });
});

app.post("/erc20/authorizations", async (req, res) => {
  const uuid = req.body.uuid as string | undefined;
  const intent = req.body.intent as IntentERC20 | undefined;
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
    const cachedSolution: CachedSolutionERC20 | undefined = await redis
      .get(`solver:${uuid}`)
      .then((r) => (r ? JSON.parse(r) : undefined));
    if (!cachedSolution) {
      return res.status(400).send({ error: `Could not find uuid ${uuid}` });
    }

    await jobs.txSolverERC20.addToQueue(cachedSolution.intent, {
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
    await jobs.txSolverERC20.addToQueue(intent, {
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

// ERC721

app.post("/erc721/intents", async (req, res) => {
  const intent = req.body.intent as IntentERC721;
  await jobs.txSolverERC721.addToQueue(intent);

  return res.json({ message: "Success" });
});

app.post("/erc721/authorizations", async (req, res) => {
  const uuid = req.body.uuid as string | undefined;
  const intent = req.body.intent as IntentERC721 | undefined;
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
    const cachedSolution: CachedSolutionERC721 | undefined = await redis
      .get(`solver:${uuid}`)
      .then((r) => (r ? JSON.parse(r) : undefined));
    if (!cachedSolution) {
      return res.status(400).send({ error: `Could not find uuid ${uuid}` });
    }

    await jobs.txSolverERC721.addToQueue(cachedSolution.intent, {
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
    await jobs.txSolverERC721.addToQueue(intent, {
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
