/*
  The crawler: discovery, fetching, cleaning, platform detection. Pure
  functions plus thin fetch wrappers; nothing here imports server-only, so
  the route handlers and the tests can both use it.
*/
import type { config } from "@/config";

export type CrawlerConfig = typeof config.crawl;

export * from "./clean";
export * from "./discover";
export * from "./fetch";
export * from "./images";
export * from "./links";
export * from "./platform";
export * from "./robots";
export * from "./sitemap";
export * from "./text";
export * from "./url";
