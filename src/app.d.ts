import type { Session, SupabaseClient, User } from '@supabase/supabase-js';

declare global {
	namespace App {
		interface Locals {
			supabase: SupabaseClient;
			safeGetSession: () => Promise<{ session: Session | null; user: User | null }>;
			isAdmin: boolean;
			/** Display name of the signed-in user. Null when signed out. */
			username: string | null;
			/** True while the username is still system-derived and unconfirmed. */
			usernameIsGenerated: boolean;
		}
		interface PageData {
			session: Session | null;
			user: User | null;
			isAdmin: boolean;
			username: string | null;
			usernameIsGenerated: boolean;
		}
	}
}

export {};
