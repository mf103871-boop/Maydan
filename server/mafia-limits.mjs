// Sanity bounds for the configured Mafia voice caps, not the caps themselves.
// The operator sets MAFIA_MAX_ACTIVE_ROOMS and MAFIA_MAX_VOICE_PARTICIPANTS from
// the verified provider quota; the release guard checks them against it. No
// imports: the offline release guard loads this file too.
export const MAFIA_ROOMS_CEILING = 1000;
export const MAFIA_VOICE_CEILING = 12_000;
