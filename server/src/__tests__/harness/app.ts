import express, { type Express as ExpressApp, type Router } from "express";
import { errorHandler } from "../../middleware/index.js";
import { boardActor } from "./actor.js";
import type { Actor } from "./actor.js";

type RouteFactory = (db?: unknown) => Router | express.Router;

export interface BuildAppOptions {
  routes: RouteFactory;
  db?: unknown;
  actor?: Actor;
  mountPath?: string;
}

export function buildApp(options: BuildAppOptions): ExpressApp {
  const { routes, db, actor, mountPath = "/api" } = options;
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => {
    req.actor = actor ?? boardActor();
    next();
  });
  app.use(mountPath, routes(db));
  app.use(errorHandler);
  return app;
}