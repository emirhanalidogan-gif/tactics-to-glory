import { createFileRoute } from "@tanstack/react-router";

import gameShell from "../game/shell.html?raw";

// The game is a prebuilt single-page app living in public/ufm. "/" serves its own HTML shell
// (title, description and social tags included) instead of rendering a React page here.
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ultimate Football Manager — Futbol Menajerlik Simülasyonu" },
      {
        name: "description",
        content:
          "17 ligden bir kulüp seç: Süper Lig, Premier Lig, LaLiga, Brasileirão, MLS ve fazlası. Dünya Kupası, EURO ve Uluslar Ligi.",
      },
      { property: "og:title", content: "Ultimate Football Manager" },
      {
        property: "og:description",
        content: "Kadro, taktik kartları, transfer, milli turnuvalar ve canlı 2D maçlar — futbol menajerlik oyunu.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  server: {
    handlers: {
      GET: async () =>
        new Response(gameShell, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-cache",
          },
        }),
    },
  },
  component: () => null,
});
