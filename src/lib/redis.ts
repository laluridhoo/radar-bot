import { Redis } from "@upstash/redis";

/**
 * Client Upstash Redis.
 * Membaca UPSTASH_REDIS_REST_URL dan UPSTASH_REDIS_REST_TOKEN dari environment.
 */
export const redis = Redis.fromEnv();
