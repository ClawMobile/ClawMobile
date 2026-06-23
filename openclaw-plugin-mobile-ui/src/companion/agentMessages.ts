import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

export type AgentMessageDirection = "incoming" | "outgoing";
export type AgentMessageStatus = "received" | "read" | "sent" | "failed" | "relay_pending";

export type AgentContactSummary = {
  id?: string;
  pubkey?: string;
  npub?: string;
  label?: string;
  trusted?: boolean;
  relays?: string[];
  createdAt?: number;
  updatedAt?: number;
};

export type StoredAgentMessage = {
  id: string;
  agentId: string;
  pubkey?: string;
  npub?: string;
  label?: string;
  direction: AgentMessageDirection;
  text: string;
  createdAt: number;
  updatedAt: number;
  status: AgentMessageStatus;
  read: boolean;
  eventId?: string;
  pendingImportId?: string;
  envelopeType?: string;
  relays?: string[];
  error?: string;
};

export type AgentConversationSummary = {
  agentId: string;
  pubkey?: string;
  npub?: string;
  label: string;
  trusted: boolean;
  lastMessage: string;
  lastMessageAt?: number;
  unreadCount: number;
  messageCount: number;
  hasPendingSkillImport: boolean;
  status: AgentMessageStatus | "ok";
  updatedAt?: number;
};

type AgentMessageStore = {
  version: number;
  updatedAt: number;
  messages: StoredAgentMessage[];
  hiddenBeforeByAgent?: Record<string, number>;
  hiddenMessageIdsByAgent?: Record<string, string[]>;
};

const STORE_VERSION = 1;
const MAX_STORED_MESSAGES = 5000;

export function listAgentConversations(contacts: AgentContactSummary[] = []) {
  const store = readStore();
  const trustedContacts = contacts.filter((contact) => contact.trusted === true);
  const contactKeyToAgentId = new Map<string, string>();
  const byAgent = new Map<string, {
    contact?: AgentContactSummary;
    messages: StoredAgentMessage[];
  }>();

  for (const contact of trustedContacts) {
    const agentId = agentIdForContact(contact);
    if (!agentId) continue;
    byAgent.set(agentId, { contact, messages: [] });
    for (const key of contactKeys(contact)) {
      contactKeyToAgentId.set(key, agentId);
    }
  }

  for (const message of store.messages) {
    const agentId = message.agentId || agentIdForMessage(message);
    if (!agentId) continue;
    const trustedAgentId = messageKeys(message)
      .map((key) => contactKeyToAgentId.get(key))
      .find((key): key is string => Boolean(key));
    if (!trustedAgentId) continue;
    const existing = byAgent.get(trustedAgentId) || { messages: [] };
    existing.messages.push(message);
    byAgent.set(trustedAgentId, existing);
  }

  const conversations: AgentConversationSummary[] = Array.from(byAgent.entries()).map(([agentId, item]) => {
    const contact = item.contact;
    const messages = visibleMessagesForAgent(store, agentId, item.messages)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const latest = messages[0];
    const failed = messages.find((message) => message.status === "failed");
    return {
      agentId,
      pubkey: contact?.pubkey || latest?.pubkey,
      npub: contact?.npub || latest?.npub,
      label: contact?.label || latest?.label || shortAgentId(agentId),
      trusted: Boolean(contact && contact.trusted === true),
      lastMessage: latest?.text || "",
      lastMessageAt: latest?.createdAt,
      unreadCount: messages.filter((message) => message.direction === "incoming" && !message.read).length,
      messageCount: messages.length,
      hasPendingSkillImport: messages.some((message) => Boolean(message.pendingImportId)),
      status: failed?.status || latest?.status || "ok",
      updatedAt: Math.max(contact?.updatedAt || 0, ...messages.map((message) => message.updatedAt || message.createdAt || 0)) || undefined,
    };
  });

  return conversations.sort((a, b) =>
    (b.lastMessageAt || b.updatedAt || 0) - (a.lastMessageAt || a.updatedAt || 0) ||
    a.label.localeCompare(b.label),
  );
}

export function listAgentConversationMessages(
  agentId: string,
  options: { limit?: number; before?: string | number } = {},
) {
  const normalizedAgentId = String(agentId || "").trim();
  const limit = Math.min(Math.max(Number(options.limit || 100), 1), 500);
  const before = String(options.before || "").trim();
  const beforeTime = Number(before);
  const store = readStore();

  let messages = visibleMessagesForAgent(store, normalizedAgentId, store.messages)
    .filter((message) => messageMatchesAgentId(message, normalizedAgentId))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (before) {
    if (Number.isFinite(beforeTime) && beforeTime > 0) {
      messages = messages.filter((message) => (message.createdAt || 0) < beforeTime);
    } else {
      const index = messages.findIndex((message) => message.id === before || message.eventId === before);
      if (index >= 0) messages = messages.slice(index + 1);
    }
  }

  return messages.slice(0, limit).reverse();
}

export function clearAgentConversationMessages(agentId: string) {
  const normalizedAgentId = String(agentId || "").trim();
  if (!normalizedAgentId) {
    return {
      ok: false,
      message: "Agent ID is required.",
    };
  }

  const now = Date.now();
  const store = readStore();
  const visibleMessages = visibleMessagesForAgent(
    store,
    normalizedAgentId,
    store.messages.filter((message) => messageMatchesAgentId(message, normalizedAgentId)),
  );
  const visibleCount = visibleMessages.length;
  const hiddenBeforeByAgent = {
    ...(store.hiddenBeforeByAgent || {}),
    [normalizedAgentId]: now,
  };
  const hiddenMessageIdsByAgent = {
    ...(store.hiddenMessageIdsByAgent || {}),
    [normalizedAgentId]: Array.from(new Set([
      ...((store.hiddenMessageIdsByAgent || {})[normalizedAgentId] || []),
      ...visibleMessages.flatMap(hiddenKeysForMessage),
    ])).slice(-MAX_STORED_MESSAGES),
  };

  writeStore({
    ...store,
    updatedAt: now,
    hiddenBeforeByAgent,
    hiddenMessageIdsByAgent,
  });

  return {
    ok: true,
    success: true,
    agentId: normalizedAgentId,
    hiddenBefore: now,
    hiddenCount: visibleCount,
    message: visibleCount === 1 ? "Conversation message hidden." : `${visibleCount} conversation messages hidden.`,
  };
}

export function storeOutgoingAgentMessage(input: {
  eventId?: string;
  recipientPubkey: string;
  recipientNpub?: string;
  label?: string;
  text: string;
  createdAt?: number;
  status: AgentMessageStatus;
  relays?: string[];
  envelopeType?: string;
  error?: string;
}) {
  const now = Date.now();
  const createdAt = Number(input.createdAt || now);
  const message: StoredAgentMessage = {
    id: input.eventId || `out_${createdAt}_${hashText(`${input.recipientPubkey}:${input.text}`).slice(0, 10)}`,
    agentId: input.recipientNpub || input.recipientPubkey,
    pubkey: input.recipientPubkey,
    npub: input.recipientNpub,
    label: input.label,
    direction: "outgoing",
    text: String(input.text || ""),
    createdAt,
    updatedAt: now,
    status: input.status,
    read: true,
    eventId: input.eventId,
    relays: input.relays || [],
    envelopeType: input.envelopeType,
    error: input.error,
  };
  return upsertMessages([message]).messages[0];
}

export function storeIncomingAgentMessages(items: Array<{
  eventId?: string;
  fromPubkey?: string;
  fromNpub?: string;
  fromLabel?: string;
  createdAt?: number;
  text?: string;
  ok?: boolean;
  error?: string;
  pendingImportId?: string;
  envelope?: { type?: string };
}>) {
  const messages = items.map((item) => {
    const now = Date.now();
    const createdAt = Number(item.createdAt || now);
    const ok = item.ok !== false;
    const pubkey = String(item.fromPubkey || "").trim();
    const npub = String(item.fromNpub || "").trim();
    const eventId = String(item.eventId || "").trim();
    const id = eventId || `in_${createdAt}_${hashText(`${pubkey}:${npub}:${item.text || ""}`).slice(0, 10)}`;
    return {
      id,
      agentId: npub || pubkey,
      pubkey,
      npub,
      label: item.fromLabel,
      direction: "incoming" as const,
      text: ok ? String(item.text || "") : "",
      createdAt,
      updatedAt: now,
      status: ok ? "received" as const : "failed" as const,
      read: false,
      eventId,
      pendingImportId: item.pendingImportId,
      envelopeType: item.envelope?.type,
      error: item.error,
    };
  });
  return upsertMessages(messages);
}

export function markAgentMessageRead(
  messageId: string,
  options: { conversation?: boolean } = {},
) {
  const store = readStore();
  const target = store.messages.find((message) => message.id === messageId || message.eventId === messageId);
  if (!target) {
    return {
      ok: false,
      message: `Agent message not found: ${messageId}`,
    };
  }

  const now = Date.now();
  let updatedCount = 0;
  const messages = store.messages.map((message) => {
    const shouldMark = options.conversation
      ? message.direction === "incoming" && messageMatchesAgentId(message, target.agentId)
      : message.id === target.id;
    if (!shouldMark || message.read) return message;
    updatedCount += 1;
    return {
      ...message,
      read: true,
      status: message.status === "received" ? "read" as const : message.status,
      updatedAt: now,
    };
  });
  writeStore({ ...store, updatedAt: now, messages });
  return {
    ok: true,
    message: updatedCount === 1 ? "Message marked as read." : `${updatedCount} messages marked as read.`,
    updatedCount,
  };
}

function upsertMessages(messages: StoredAgentMessage[]) {
  const store = readStore();
  const byKey = new Map<string, StoredAgentMessage>();
  for (const message of store.messages) {
    byKey.set(messageKey(message), message);
  }

  let insertedCount = 0;
  let updatedCount = 0;
  const conversationIds = new Set<string>();
  for (const message of messages) {
    const key = messageKey(message);
    const existing = byKey.get(key);
    if (existing) {
      updatedCount += 1;
      byKey.set(key, mergeMessage(existing, message));
    } else {
      insertedCount += 1;
      byKey.set(key, message);
    }
    if (message.agentId) conversationIds.add(message.agentId);
  }

  const nextMessages = Array.from(byKey.values())
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, MAX_STORED_MESSAGES);
  const nextStore = {
    version: STORE_VERSION,
    updatedAt: Date.now(),
    messages: nextMessages,
    hiddenBeforeByAgent: store.hiddenBeforeByAgent || {},
    hiddenMessageIdsByAgent: store.hiddenMessageIdsByAgent || {},
  };
  writeStore(nextStore);

  return {
    ok: true,
    messages,
    insertedCount,
    updatedCount,
    conversationIds: Array.from(conversationIds),
  };
}

function mergeMessage(existing: StoredAgentMessage, incoming: StoredAgentMessage): StoredAgentMessage {
  const read = existing.read || incoming.read;
  return {
    ...existing,
    ...incoming,
    read,
    status: read && incoming.status === "received" ? "read" : incoming.status || existing.status,
    createdAt: existing.createdAt || incoming.createdAt,
    updatedAt: Math.max(existing.updatedAt || 0, incoming.updatedAt || 0, Date.now()),
  };
}

function visibleMessagesForAgent(
  store: AgentMessageStore,
  agentId: string,
  messages: StoredAgentMessage[],
) {
  const hiddenBefore = hiddenBeforeForAgent(store, agentId);
  const hiddenMessageIds = hiddenMessageIdsForAgent(store, agentId);
  return messages.filter((message) => {
    if (hiddenMessageIds.has(message.id) || (message.eventId && hiddenMessageIds.has(message.eventId))) {
      return false;
    }
    return !hiddenBefore || (message.createdAt || 0) > hiddenBefore;
  });
}

function hiddenBeforeForAgent(store: AgentMessageStore, agentId: string) {
  if (!agentId) return 0;
  const hiddenBeforeByAgent = store.hiddenBeforeByAgent || {};
  let hiddenBefore = Number(hiddenBeforeByAgent[agentId] || 0);
  for (const message of store.messages) {
    if (!messageMatchesAgentId(message, agentId)) continue;
    hiddenBefore = Math.max(
      hiddenBefore,
      Number(hiddenBeforeByAgent[message.agentId] || 0),
      Number(message.pubkey ? hiddenBeforeByAgent[message.pubkey] : 0),
      Number(message.npub ? hiddenBeforeByAgent[message.npub] : 0),
    );
  }
  return hiddenBefore;
}

function hiddenMessageIdsForAgent(store: AgentMessageStore, agentId: string) {
  const hiddenMessageIdsByAgent = store.hiddenMessageIdsByAgent || {};
  const ids = new Set<string>(hiddenMessageIdsByAgent[agentId] || []);
  for (const message of store.messages) {
    if (!messageMatchesAgentId(message, agentId)) continue;
    for (const key of [
      message.agentId,
      message.pubkey,
      message.npub,
    ]) {
      if (!key) continue;
      for (const id of hiddenMessageIdsByAgent[key] || []) {
        ids.add(id);
      }
    }
  }
  return ids;
}

function hiddenKeysForMessage(message: StoredAgentMessage) {
  return [message.id, message.eventId].filter((value): value is string => Boolean(value));
}

function messageKey(message: StoredAgentMessage) {
  return message.eventId ? `event:${message.eventId}` : `id:${message.id}`;
}

function messageMatchesAgentId(message: StoredAgentMessage, agentId: string) {
  if (!agentId) return false;
  return agentId === message.agentId ||
    agentId === message.pubkey ||
    agentId === message.npub;
}

function agentIdForContact(contact: AgentContactSummary) {
  return String(contact.npub || contact.pubkey || contact.id || "").trim();
}

function agentIdForMessage(message: StoredAgentMessage) {
  return String(message.agentId || message.npub || message.pubkey || "").trim();
}

function contactKeys(contact: AgentContactSummary) {
  return [contact.id, contact.npub, contact.pubkey]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function messageKeys(message: StoredAgentMessage) {
  return [message.agentId, message.npub, message.pubkey]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function readStore(): AgentMessageStore {
  const defaults: AgentMessageStore = {
    version: STORE_VERSION,
    updatedAt: 0,
    messages: [],
  };
  try {
    const parsed = JSON.parse(fs.readFileSync(storeFile(), "utf8"));
    return {
      ...defaults,
      ...parsed,
      messages: Array.isArray(parsed.messages) ? parsed.messages.map(normalizeMessage).filter(Boolean) : [],
      hiddenBeforeByAgent: normalizeHiddenBeforeByAgent(parsed.hiddenBeforeByAgent),
      hiddenMessageIdsByAgent: normalizeHiddenMessageIdsByAgent(parsed.hiddenMessageIdsByAgent),
    };
  } catch {
    return defaults;
  }
}

function writeStore(store: AgentMessageStore) {
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
  fs.writeFileSync(storeFile(), `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(storeFile(), 0o600);
  } catch {
    // Termux filesystems may ignore chmod.
  }
}

function normalizeMessage(value: any): StoredAgentMessage | null {
  if (!value || typeof value !== "object") return null;
  const agentId = String(value.agentId || value.npub || value.pubkey || "").trim();
  const text = String(value.text || "");
  const id = String(value.id || value.eventId || "").trim();
  if (!agentId || !id) return null;
  const direction: AgentMessageDirection = value.direction === "outgoing" ? "outgoing" : "incoming";
  return {
    id,
    agentId,
    pubkey: String(value.pubkey || "").trim() || undefined,
    npub: String(value.npub || "").trim() || undefined,
    label: String(value.label || "").trim() || undefined,
    direction,
    text,
    createdAt: Number(value.createdAt || Date.now()),
    updatedAt: Number(value.updatedAt || value.createdAt || Date.now()),
    status: normalizeStatus(value.status, direction),
    read: Boolean(value.read || direction === "outgoing"),
    eventId: String(value.eventId || "").trim() || undefined,
    pendingImportId: String(value.pendingImportId || "").trim() || undefined,
    envelopeType: String(value.envelopeType || "").trim() || undefined,
    relays: Array.isArray(value.relays) ? value.relays.map(String).filter(Boolean) : undefined,
    error: String(value.error || "").trim() || undefined,
  };
}

function normalizeStatus(value: any, direction: AgentMessageDirection): AgentMessageStatus {
  const text = String(value || "").trim();
  if (text === "read" || text === "received" || text === "sent" || text === "failed" || text === "relay_pending") {
    return text;
  }
  return direction === "outgoing" ? "sent" : "received";
}

function normalizeHiddenBeforeByAgent(value: any): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const agentId = String(key || "").trim();
    const hiddenBefore = Number(raw || 0);
    if (agentId && Number.isFinite(hiddenBefore) && hiddenBefore > 0) {
      result[agentId] = hiddenBefore;
    }
  }
  return result;
}

function normalizeHiddenMessageIdsByAgent(value: any): Record<string, string[]> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(value)) {
    const agentId = String(key || "").trim();
    if (!agentId || !Array.isArray(raw)) continue;
    const ids = Array.from(new Set(raw.map(String).map((item) => item.trim()).filter(Boolean)));
    if (ids.length) result[agentId] = ids.slice(-MAX_STORED_MESSAGES);
  }
  return result;
}

function storeFile() {
  const configured = (process.env.CLAWMOBILE_AGENT_MESSAGES_FILE || "").trim();
  return configured || path.join(os.homedir(), ".clawmobile", "nostr", "messages.json");
}

function hashText(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function shortAgentId(agentId: string) {
  return agentId.length <= 22 ? agentId : `${agentId.slice(0, 12)}...${agentId.slice(-6)}`;
}
