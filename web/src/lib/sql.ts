/** Escapes LIKE/ILIKE wildcards so user text is matched literally ("100%" must not match everything). Use with the default `\` escape. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);
export const contains = (s: string) => `%${likeEscape(s.trim())}%`;
