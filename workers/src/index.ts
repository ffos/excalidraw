import { route } from "./router";
import type { Env } from "./types";

export { CollabRoom } from "./room";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await route(request, env);
    if (response !== null) {
      return response;
    }
    // Authenticated non-API request — serve the pre-built SPA from the
    // Workers Static Assets binding.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
