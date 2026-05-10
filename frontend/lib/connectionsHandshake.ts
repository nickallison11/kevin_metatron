/** GET /connections response (connect handshakes only). */

export type ConnectListItem = {
  id: string;
  other_user_id: string;
  other_email: string;
  other_role: string;
  firm_name: string | null;
  company_name: string | null;
  status: string;
  requested_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  created_at: string;
};

export type ConnectListsResponse = {
  incoming: ConnectListItem[];
  outgoing: ConnectListItem[];
};

export function acceptedPeerUserIds(data: ConnectListsResponse): Set<string> {
  const s = new Set<string>();
  for (const row of [...data.incoming, ...data.outgoing]) {
    if (row.accepted_at) s.add(row.other_user_id);
  }
  return s;
}

/** Pending incoming connect from `otherUserId` (caller is `to_user`). */
export function pendingIncomingConnectionId(
  data: ConnectListsResponse,
  otherUserId: string,
): string | undefined {
  return data.incoming.find(
    (c) =>
      c.other_user_id === otherUserId &&
      !c.accepted_at &&
      !c.declined_at &&
      c.status !== "declined",
  )?.id;
}
