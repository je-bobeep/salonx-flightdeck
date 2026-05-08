// CSRF state cookie name for the Lark OAuth dance.
// Hoisted out of route handlers because Next.js's generated route types
// disallow non-handler exports from `route.ts` files.
export const STATE_COOKIE = "flightdeck_oauth_state";
