import { route } from "./router";
import type { Env } from "./types";

export { CollabRoom } from "./room";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const apiResponse = await route(request, env);
    if (apiResponse) {
      return apiResponse;
    }

    // Anything else falls through to the static assets binding (Pages /
    // Workers Sites). When deploying with `wrangler pages deploy`, Pages
    // wraps this Worker and serves /static-assets first; the Worker only
    // sees what Pages doesn't recognise.
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
