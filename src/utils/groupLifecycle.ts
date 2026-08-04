// One profile create + one group delete + one personal-settings copy + one
// backend invite-code reservation delete leave room for member updates in
// Firestore's 500-write atomic batch. Legacy groups may use one write less, but
// the conservative limit keeps both shapes atomic.
export const MAX_ATOMIC_GROUP_MEMBERS = 496;

export const canDissolveGroupAtomically = (memberCount: number): boolean =>
  Number.isInteger(memberCount)
  && memberCount > 0
  && memberCount <= MAX_ATOMIC_GROUP_MEMBERS;
