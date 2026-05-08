// Static configuration for the BD-feedback poller.
//
// To wire a different chat: change CHAT_ID. To poll multiple chats, this would
// become an array — for v1 we have exactly one source.

export const POLLER_CONFIG = {
  /** SalonX BD feedback group chat. */
  chatId: "oc_545df3dd4bdb3b1f625ff88fbd3b9380",
  /** Forever-mode tick. 15 min per the user's spec. */
  intervalMs: 15 * 60 * 1000,
  /** When poller_state has no prior watermark, look this far back on the
   *  first run. Default: 1 hour. The user can override via env. */
  initialLookbackMs: 60 * 60 * 1000,
  /** Hard cap on messages processed per poll cycle to avoid runaway costs
   *  on a backfill. */
  maxMessagesPerCycle: 50,
  /** Skip messages whose body is shorter than this — usually an emoji or
   *  acknowledgement that classification will reject anyway. */
  minTextLength: 6,
} as const;
