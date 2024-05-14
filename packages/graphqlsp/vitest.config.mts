import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { graphql: "graphql/index.js" } 
  }
})
