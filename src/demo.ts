import payload from "./demo-payload.json";

/**
 * A real, unedited response from the OpenAlex API — the record for Piwowar et al.,
 * "The state of OA" (https://api.openalex.org/works/W2741809807).
 *
 * Real rather than invented, because a made-up payload cannot demonstrate the thing that
 * actually makes a payload hard: 559 unique paths over 1,456 nodes, three overlapping
 * location fields, 52 nulls, and an `abstract_inverted_index` of 167 opaque keys.
 *
 * OpenAlex data is released under CC0, so it can be redistributed freely.
 *
 * Bundled rather than fetched: the app ships `connect-src 'none'` and cannot load
 * anything over the network, including its own sample.
 */
export const DEMO_NAME = "openalex-work-sample";

export const DEMO_PAYLOAD: unknown = payload;
