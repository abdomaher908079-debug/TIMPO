import { supabase } from './supabase';

/** A row of a Studio team: someone invited, or a member who joined. */
export interface TeamMember {
  id: number;
  owner_id: string;
  owner_email: string | null;
  email: string;
  user_id: string | null;
  status: 'invited' | 'active';
}

// The owner plus 2 people.
export const TEAM_SIZE = 3;

function db() {
  if (!supabase) throw new Error('Teams need real accounts, so they aren’t available in demo mode.');
  return supabase;
}

/** Everything this user can see: their own team (as owner), the team they're in, and invites to them. */
export async function listTeam(): Promise<TeamMember[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('team_members').select('*').order('created_at');
  if (error) throw new Error('We couldn’t load your team.');
  return data as TeamMember[];
}

export async function invite(ownerId: string, email: string): Promise<void> {
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error('Enter a valid email address.');
  const { error } = await db().from('team_members').insert({ owner_id: ownerId, email: clean });
  if (error) {
    if (error.code === '23505') throw new Error('This person is already invited.');
    throw new Error(error.code === 'P0001' ? error.message : 'We couldn’t send this invite. Please try again.');
  }
}

/** Removes someone (owner), leaves the team (member) or declines an invite (invited person). */
export async function removeMember(id: number): Promise<void> {
  const { error } = await db().from('team_members').delete().eq('id', id);
  if (error) throw new Error('That didn’t work. Please try again.');
}

export async function joinTeam(id: number): Promise<void> {
  const { error } = await db().rpc('join_team', { invite_id: id });
  if (error) throw new Error(error.code === 'P0001' ? error.message : 'We couldn’t join this team. Please try again.');
}
