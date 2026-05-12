import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://armory.styrene.io",
  integrations: [sitemap()],
  output: "static"
});
