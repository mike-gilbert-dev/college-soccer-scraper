// Username rules, shared by the register form (live availability feedback), the
// server actions, and the tests.
//
// These rules are duplicated in SQL (the `profiles_username_format` check
// constraint and `is_reserved_username()`). That duplication is deliberate: this
// module gives fast, testable client feedback, while SQL is the security
// backstop a crafted request cannot bypass. Change one, change the other.
//
// Keep this module dependency-free — no $app, no Supabase — so it stays trivial
// to unit test.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

/** Must stay in lockstep with the `profiles_username_format` check constraint. */
export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;

/** Must stay in lockstep with `public.is_reserved_username()`. */
export const RESERVED_USERNAMES: readonly string[] = [
	'admin',
	'administrator',
	'moderator',
	'mod',
	'staff',
	'support',
	'system',
	'root',
	'null',
	'undefined',
	'anonymous',
	'deleted',
	'collegesoccer',
	'csio',
	'ncaa'
];

export type UsernameError = 'too_short' | 'too_long' | 'invalid_chars' | 'reserved';

/** Returns null when the username is valid, otherwise why it failed. */
export function validateUsername(raw: string): UsernameError | null {
	const value = (raw ?? '').trim();

	if (value.length < USERNAME_MIN) return 'too_short';
	if (value.length > USERNAME_MAX) return 'too_long';
	if (!USERNAME_PATTERN.test(value)) return 'invalid_chars';
	if (RESERVED_USERNAMES.includes(value.toLowerCase())) return 'reserved';

	return null;
}

/** Human-readable message for each failure mode. */
export function usernameErrorMessage(error: UsernameError): string {
	switch (error) {
		case 'too_short':
			return `Username must be at least ${USERNAME_MIN} characters.`;
		case 'too_long':
			return `Username must be ${USERNAME_MAX} characters or fewer.`;
		case 'invalid_chars':
			return 'Username can only contain letters, numbers and underscores.';
		case 'reserved':
			return 'That username is reserved.';
	}
}

/**
 * Turn an email address into a candidate username: take the local part, strip
 * anything outside [A-Za-z0-9_], lowercase it, then force it into the 3–20 range.
 *
 * Mirrors the backfill in the profiles_username migration. Collision handling is
 * the caller's job — this is deterministic and knows nothing about existing rows.
 */
export function deriveUsernameFromEmail(email: string): string {
	const localPart = (email ?? '').split('@')[0] ?? '';
	const cleaned = localPart.replace(/[^A-Za-z0-9_]/g, '').toLowerCase();

	if (cleaned.length === 0) return 'user';
	if (cleaned.length < USERNAME_MIN) return cleaned.padEnd(USERNAME_MIN, '0');

	return cleaned.slice(0, USERNAME_MAX);
}
