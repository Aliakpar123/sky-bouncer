/**
 * Message formatting for the admin review commands.
 *
 * Venue names, offers and contacts are typed by applicants, so they reach
 * these messages as untrusted text. Everything user-supplied goes through
 * `esc` and the messages are sent with HTML parse mode: a name like
 * "Bob's <b>Cafe</b>" must render as text, not as markup, and must not make
 * Telegram reject the whole message.
 */

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** Short handle for an application, so an admin types 8 chars instead of a UUID. */
export function shortId(uuid) {
  return String(uuid).slice(0, 8);
}

export function describeApplication(app) {
  return [
    `<b>${esc(app.name)}</b>  <code>${shortId(app.id)}</code>`,
    app.category ? `Category: ${esc(app.category)}` : null,
    `Offer: ${esc(app.offer_title)}`,
    app.contact ? `Contact: ${esc(app.contact)}` : null,
    `Map: https://www.openstreetmap.org/?mlat=${app.lat}&amp;mlon=${app.lng}#map=19/${app.lat}/${app.lng}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Parses `/approve <id> [points]`. Returns an `error` rather than throwing so
 * the command handler can reply with it.
 */
export function parseApproveArgs(raw) {
  const [handle, pointsArg, ...rest] = String(raw ?? '').trim().split(/\s+/).filter(Boolean);

  if (!handle) return { error: 'Usage: /approve <id> [points]' };
  if (rest.length) return { error: 'Usage: /approve <id> [points]' };

  if (pointsArg === undefined) return { handle, rewardPoints: 150 };

  // Plain decimal digits only. Number() would otherwise accept "1e3" and
  // "0x10" as 1000 and 16 — forms nobody types on purpose when setting how
  // many points a venue mints, and which read as something else at a glance.
  if (!/^\d{1,4}$/.test(pointsArg)) {
    return { error: 'Points must be a whole number between 0 and 1000.' };
  }

  const rewardPoints = Number(pointsArg);
  if (rewardPoints > 1000) {
    return { error: 'Points must be a whole number between 0 and 1000.' };
  }
  return { handle, rewardPoints };
}

/** Parses `/reject <id> [reason]`; the reason is the rest of the line. */
export function parseRejectArgs(raw) {
  const [handle, ...reasonParts] = String(raw ?? '').trim().split(/\s+/).filter(Boolean);
  if (!handle) return { error: 'Usage: /reject <id> [reason]' };
  return { handle, reason: reasonParts.join(' ') || null };
}

/**
 * Picks the pending application an 8-char handle refers to. An ambiguous
 * prefix is an error rather than a guess: the wrong pick creates a live venue
 * that mints points.
 */
export function resolveApplication(applications, handle) {
  const matches = (applications ?? []).filter(
    (app) => shortId(app.id) === String(handle).toLowerCase()
  );
  if (matches.length === 0) return { error: 'No pending application with that id.' };
  if (matches.length > 1) return { error: 'That id matches more than one application.' };
  return { application: matches[0] };
}
