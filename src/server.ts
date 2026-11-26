import { serve } from "@hono/node-server";
import app from "./index.js";

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? "0.0.0.0";

serve(
  {
    fetch: app.fetch,
    port,
    hostname,
  },
  (info) => {
    console.log(`fxhoyo listening on http://${info.address}:${info.port}`);
  }
);
