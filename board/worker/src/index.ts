import { createApp } from "./app";
import { D1Store } from "./store";

export interface Env {
  DB: D1Database;
  BOARD_INGEST_SECRET: string;
  ALLOWED_ORIGINS?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const app = createApp({
      store: new D1Store(env.DB),
      secret: env.BOARD_INGEST_SECRET ?? "",
      allowedOrigins: (env.ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
    return app.fetch(request, ctx);
  },
} satisfies ExportedHandler<Env>;
