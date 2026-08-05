import { describe, it, expect } from 'vitest';
import {
	validateUsername,
	deriveUsernameFromEmail,
	usernameErrorMessage,
	USERNAME_PATTERN,
	USERNAME_MIN,
	USERNAME_MAX,
	RESERVED_USERNAMES
} from './username';

describe('validateUsername', () => {
	it('accepts valid usernames', () => {
		for (const name of ['abc', 'ilgilbert30', 'kendall_holliday', 'A1_b2', 'x'.repeat(20)]) {
			expect(validateUsername(name), name).toBeNull();
		}
	});

	it('rejects usernames that are too short', () => {
		expect(validateUsername('')).toBe('too_short');
		expect(validateUsername('a')).toBe('too_short');
		expect(validateUsername('ab')).toBe('too_short');
	});

	it('rejects usernames that are too long', () => {
		expect(validateUsername('x'.repeat(21))).toBe('too_long');
	});

	it('accepts exactly the boundary lengths', () => {
		expect(validateUsername('x'.repeat(USERNAME_MIN))).toBeNull();
		expect(validateUsername('x'.repeat(USERNAME_MAX))).toBeNull();
	});

	it('rejects invalid characters', () => {
		for (const name of ['has space', 'has-dash', 'has.dot', 'has+plus', 'emoji😀x', 'oh@no']) {
			expect(validateUsername(name), name).toBe('invalid_chars');
		}
	});

	it('rejects reserved names case-insensitively', () => {
		expect(validateUsername('admin')).toBe('reserved');
		expect(validateUsername('ADMIN')).toBe('reserved');
		expect(validateUsername('Admin')).toBe('reserved');
		expect(validateUsername('NCAA')).toBe('reserved');
		expect(validateUsername('CollegeSoccer')).toBe('reserved');
	});

	it('checks every reserved word', () => {
		for (const reserved of RESERVED_USERNAMES) {
			// Only words that would otherwise be valid should report 'reserved';
			// anything under 3 chars fails on length first.
			const expected = reserved.length >= USERNAME_MIN ? 'reserved' : 'too_short';
			expect(validateUsername(reserved), reserved).toBe(expected);
		}
	});

	it('trims surrounding whitespace before validating', () => {
		expect(validateUsername('  validname  ')).toBeNull();
	});

	it('reports length problems before character problems', () => {
		// "a-" is both too short and contains an invalid character
		expect(validateUsername('a-')).toBe('too_short');
	});
});

describe('usernameErrorMessage', () => {
	it('returns a message for every error type', () => {
		for (const error of ['too_short', 'too_long', 'invalid_chars', 'reserved'] as const) {
			expect(usernameErrorMessage(error).length).toBeGreaterThan(0);
		}
	});
});

describe('deriveUsernameFromEmail', () => {
	it('derives from the local part of the address', () => {
		expect(deriveUsernameFromEmail('ilgilbert30@gmail.com')).toBe('ilgilbert30');
		expect(deriveUsernameFromEmail('wlgildog@gmail.com')).toBe('wlgildog');
		expect(deriveUsernameFromEmail('kendallholliday@gmail.com')).toBe('kendallholliday');
	});

	it('strips dots and plus-addressing', () => {
		expect(deriveUsernameFromEmail('first.last@example.com')).toBe('firstlast');
		expect(deriveUsernameFromEmail('user+newsletter@example.com')).toBe('usernewsletter');
		expect(deriveUsernameFromEmail('a.b.c+d.e@example.com')).toBe('abcde');
	});

	it('lowercases', () => {
		expect(deriveUsernameFromEmail('MixedCase@example.com')).toBe('mixedcase');
	});

	it('preserves underscores', () => {
		expect(deriveUsernameFromEmail('some_body@example.com')).toBe('some_body');
	});

	it('pads local parts shorter than the minimum', () => {
		expect(deriveUsernameFromEmail('a@example.com')).toBe('a00');
		expect(deriveUsernameFromEmail('ab@example.com')).toBe('ab0');
	});

	it('truncates local parts longer than the maximum', () => {
		const derived = deriveUsernameFromEmail(`${'x'.repeat(40)}@example.com`);
		expect(derived).toHaveLength(USERNAME_MAX);
	});

	it('falls back to "user" when nothing survives cleaning', () => {
		expect(deriveUsernameFromEmail('...@example.com')).toBe('user');
		expect(deriveUsernameFromEmail('+++@example.com')).toBe('user');
	});

	it('always produces something that passes validation', () => {
		const emails = [
			'ilgilbert30@gmail.com',
			'a@example.com',
			'first.last@example.com',
			'...@example.com',
			`${'x'.repeat(40)}@example.com`,
			'MixedCase@example.com'
		];
		for (const email of emails) {
			expect(validateUsername(deriveUsernameFromEmail(email)), email).toBeNull();
		}
	});
});

describe('USERNAME_PATTERN', () => {
	it('encodes the same bounds the constants declare', () => {
		expect(USERNAME_PATTERN.source).toBe(`^[A-Za-z0-9_]{${USERNAME_MIN},${USERNAME_MAX}}$`);
	});
});
