import Fastify from "fastify";
import cors from "@fastify/cors";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get("/health", async () => ({
  ok: true,
  service: "splatterhouse-api",
  version: "0.1.0"
}));

// TODO(security): verify Firebase ID tokens before adding player endpoints.
// Never accept a client-submitted score as authoritative without server-side validation.

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });
