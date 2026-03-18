export type AuthorizationPort = {
  assertCanManageSubscriptions(context: { actorId?: string | null; scope?: string | null }): Promise<void>;
};