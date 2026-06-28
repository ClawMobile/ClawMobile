import fs from "fs";
import os from "os";
import path from "path";
import {
  SimplePool,
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip04,
  nip19,
  verifyEvent,
  type Event,
} from "nostr-tools";
import {
  createSkillSharePackage,
  storePendingSkillImport,
  type SkillSharePackage,
} from "./skillSharing";
import { storeIncomingAgentMessages, storeOutgoingAgentMessage } from "./agentMessages";

const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
];
const MESSAGE_KIND = 4;
const MAX_MESSAGE_CHARS = 24 * 1024;

type NostrContact = {
  id: string;
  pubkey: string;
  npub: string;
  label: string;
  relays?: string[];
  trusted: boolean;
  createdAt: number;
  updatedAt: number;
};

type NostrConfig = {
  secretKeyHex?: string;
  publicKey?: string;
  relays: string[];
  contacts: NostrContact[];
  updatedAt?: number;
};

export type NostrEnvelope = {
  type: "clawmobile.agent_message" | "clawmobile.skill.share";
  version: number;
  createdAt: number;
  message: string;
  payload?: any;
};

export function getNostrStatus() {
  const config = readConfig();
  const publicKey = config.publicKey || publicKeyFromSecret(config.secretKeyHex);
  return {
    ok: true,
    configured: Boolean(config.secretKeyHex && publicKey),
    publicKey,
    npub: publicKey ? nip19.npubEncode(publicKey) : undefined,
    relays: config.relays,
    contacts: config.contacts.map(redactContact),
    message: publicKey
      ? "Nostr identity is configured."
      : "Nostr identity is not configured yet.",
  };
}

export function setupNostrIdentity(input: { secretKey?: string; relays?: string[]; revealSecret?: boolean } = {}) {
  const config = readConfig();
  const existingSecret = hexToBytes(config.secretKeyHex || "");
  const generatedSecret = !input.secretKey && !existingSecret;
  const secretKey = input.secretKey
    ? parseSecretKey(input.secretKey)
    : existingSecret || generateSecretKey();
  const publicKey = getPublicKey(secretKey);
  const relays = normalizeRelays(input.relays?.length ? input.relays : config.relays);
  const next: NostrConfig = {
    ...config,
    secretKeyHex: bytesToHex(secretKey),
    publicKey,
    relays,
    updatedAt: Date.now(),
  };
  writeConfig(next);
  const response: Record<string, any> = {
    ok: true,
    configured: true,
    publicKey,
    npub: nip19.npubEncode(publicKey),
    relays,
    message: input.secretKey
      ? "Nostr identity imported."
      : generatedSecret
        ? "Nostr identity is ready. Save the nsec value; it is shown only when generated or explicitly revealed."
        : "Nostr identity is ready.",
  };
  if (generatedSecret || input.revealSecret === true) {
    response.nsec = nip19.nsecEncode(secretKey);
  }
  return response;
}

export function listNostrContacts() {
  return {
    ok: true,
    contacts: readConfig().contacts.map(redactContact),
  };
}

export function deleteNostrContact(input: { pubkey?: string; npub?: string; id?: string; value?: string }) {
  const config = readConfig();
  const value = String(input.pubkey || input.npub || input.id || input.value || "").trim();
  if (!value) {
    return {
      ok: false,
      success: false,
      message: "Contact ID is required.",
    };
  }
  const pubkey = safeParsePublicKey(value);
  const before = config.contacts.length;
  const contacts = config.contacts.filter((contact) =>
    contact.id !== value &&
    contact.npub !== value &&
    contact.pubkey !== value &&
    (!pubkey || contact.pubkey !== pubkey),
  );
  if (contacts.length === before) {
    return {
      ok: false,
      success: false,
      message: "Trusted contact was not found.",
    };
  }
  writeConfig({
    ...config,
    contacts,
    updatedAt: Date.now(),
  });
  return {
    ok: true,
    success: true,
    removedCount: before - contacts.length,
    message: "Trusted contact deleted.",
  };
}

export function upsertNostrContact(input: { pubkey?: string; npub?: string; label?: string; relays?: string[]; trusted?: boolean }) {
  const config = readConfig();
  const pubkey = parsePublicKey(input.pubkey || input.npub || "");
  const now = Date.now();
  const existing = config.contacts.find((contact) => contact.pubkey === pubkey);
  const contact: NostrContact = {
    id: existing?.id || `contact_${pubkey.slice(0, 12)}`,
    pubkey,
    npub: nip19.npubEncode(pubkey),
    label: String(input.label || existing?.label || `Nostr ${pubkey.slice(0, 8)}`).trim(),
    relays: normalizeRelays(input.relays || existing?.relays || []),
    trusted: input.trusted ?? existing?.trusted ?? true,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  const contacts = [
    contact,
    ...config.contacts.filter((item) => item.pubkey !== pubkey),
  ].sort((a, b) => a.label.localeCompare(b.label));
  writeConfig({
    ...config,
    contacts,
    updatedAt: now,
  });
  return {
    ok: true,
    contact: redactContact(contact),
    message: "Nostr contact saved.",
  };
}

export async function sendNostrAgentMessage(input: {
  recipientPubkey?: string;
  recipient?: string;
  message?: string;
  payload?: any;
  relays?: string[];
}) {
  const identity = requireIdentity();
  const recipient = parsePublicKey(input.recipientPubkey || input.recipient || "");
  const contact = contactForPubkey(recipient);
  const relays = relaysForRecipient(recipient, input.relays);
  const createdAt = Date.now();
  const envelope: NostrEnvelope = {
    type: input.payload?.type === "clawmobile.skill.share" ? "clawmobile.skill.share" : "clawmobile.agent_message",
    version: 1,
    createdAt,
    message: trimMessage(input.message || ""),
    payload: input.payload,
  };
  const event = finalizeEvent({
    kind: MESSAGE_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["p", recipient],
      ["client", "clawmobile"],
      ["type", envelope.type],
    ],
    content: nip04.encrypt(identity.secretKey, recipient, JSON.stringify(envelope)),
  }, identity.secretKey);
  const publish = await publishEvent(relays, event);
  const recipientNpub = nip19.npubEncode(recipient);
  const storedMessage = storeOutgoingAgentMessage({
    eventId: event.id,
    recipientPubkey: recipient,
    recipientNpub,
    label: contact?.label,
    text: envelope.message,
    createdAt,
    status: publish.successCount > 0 ? "sent" : "failed",
    relays,
    envelopeType: envelope.type,
    error: publish.successCount > 0 ? undefined : "Message was signed but no relay accepted it.",
  });
  return {
    ok: publish.successCount > 0,
    eventId: event.id,
    recipientPubkey: recipient,
    recipientNpub,
    relays,
    publish,
    storedMessage,
    message: publish.successCount > 0
      ? "Nostr message sent."
      : "Nostr message was signed but no relay accepted it.",
  };
}

export async function shareSkillViaNostr(skillId: string, input: {
  recipientPubkey?: string;
  recipient?: string;
  message?: string;
  relays?: string[];
}) {
  const identity = requireIdentity();
  const created = createSkillSharePackage(skillId, { senderPubkey: identity.publicKey });
  if (!created) return null;
  return sendNostrAgentMessage({
    recipientPubkey: input.recipientPubkey || input.recipient,
    relays: input.relays,
    message: input.message || `Sharing ClawMobile skill draft: ${created.package.source.name}`,
    payload: created.package,
  });
}

export async function fetchNostrInbox(input: { limit?: number; since?: number; relays?: string[]; autoStoreSkillShares?: boolean } = {}) {
  const identity = requireIdentity();
  const relays = normalizeRelays(input.relays || readConfig().relays);
  const limit = Math.min(Math.max(Number(input.limit || 50), 1), 200);
  const filter: any = {
    kinds: [MESSAGE_KIND],
    "#p": [identity.publicKey],
    limit,
  };
  if (input.since && Number.isFinite(Number(input.since))) {
    filter.since = Math.floor(Number(input.since));
  }

  const pool = new SimplePool();
  try {
    const events = await pool.querySync(relays, filter, { maxWait: 5000, label: "clawmobile-inbox" });
    const messages = events
      .filter((event) => verifyEvent(event))
      .sort((a, b) => b.created_at - a.created_at)
      .map((event) => decodeInboxEvent(identity.secretKey, event, input.autoStoreSkillShares !== false));
    const trustedMessages = messages.filter((message) => message.trustedContact === true);
    const ignoredUnknownCount = messages.length - trustedMessages.length;
    const stored = storeIncomingAgentMessages(trustedMessages);
    return {
      ok: true,
      publicKey: identity.publicKey,
      npub: nip19.npubEncode(identity.publicKey),
      relays,
      messages: trustedMessages,
      stored,
      ignoredUnknownCount,
      message: ignoredUnknownCount > 0
        ? `Fetched ${messages.length} Nostr messages. Ignored ${ignoredUnknownCount} unknown sender message${ignoredUnknownCount === 1 ? "" : "s"}.`
        : `Fetched ${messages.length} Nostr message${messages.length === 1 ? "" : "s"}.`,
    };
  } finally {
    pool.destroy();
  }
}

function decodeInboxEvent(secretKey: Uint8Array, event: Event, autoStoreSkillShares: boolean) {
  const contact = contactForPubkey(event.pubkey);
  const base = {
    eventId: event.id,
    kind: event.kind,
    fromPubkey: event.pubkey,
    fromNpub: nip19.npubEncode(event.pubkey),
    fromLabel: contact?.label,
    trustedContact: Boolean(contact && contact.trusted !== false),
    createdAt: event.created_at * 1000,
    tags: event.tags,
  };
  try {
    const text = nip04.decrypt(secretKey, event.pubkey, event.content);
    const envelope = parseEnvelope(text);
    const skillShare = extractSkillShare(envelope);
    const pendingImport = skillShare && autoStoreSkillShares && base.trustedContact === true
      ? storePendingSkillImport(skillShare, {
        transport: "nostr",
        senderPubkey: event.pubkey,
        eventId: event.id,
      })
      : undefined;
    return {
      ...base,
      ok: true,
      envelope,
      text: envelope.message,
      skillShare,
      pendingImportId: pendingImport?.importId,
    };
  } catch (error: any) {
    return {
      ...base,
      ok: false,
      error: error?.message || "Unable to decrypt or parse Nostr message.",
    };
  }
}

async function publishEvent(relays: string[], event: Event) {
  const pool = new SimplePool();
  try {
    const settled = await Promise.allSettled(pool.publish(relays, event, { maxWait: 5000 }));
    const results = settled.map((result, index) => ({
      relay: relays[index],
      ok: result.status === "fulfilled" && isRelayAcceptReason(result.value),
      message: result.status === "fulfilled" ? String(result.value || "accepted") : String(result.reason?.message || result.reason || "rejected"),
    }));
    return {
      successCount: results.filter((item) => item.ok).length,
      failureCount: results.filter((item) => !item.ok).length,
      results,
    };
  } finally {
    pool.destroy();
  }
}

function isRelayAcceptReason(value: any) {
  const reason = String(value || "accepted").toLowerCase();
  return !/(connection failure|connection failed|rejected|blocked|error|auth-required|restricted|failed)/i.test(reason);
}

function requireIdentity() {
  const config = readConfig();
  const secretKey = hexToBytes(config.secretKeyHex || "");
  if (!secretKey) {
    throw new Error("Nostr identity is not configured. Call POST /v1/extensions/nostr/setup-key first.");
  }
  const publicKey = getPublicKey(secretKey);
  return { config, secretKey, publicKey };
}

function readConfig(): NostrConfig {
  const defaults: NostrConfig = {
    relays: normalizeRelays(envRelays()),
    contacts: [],
  };
  try {
    const parsed = JSON.parse(fs.readFileSync(configFile(), "utf8"));
    return {
      ...defaults,
      ...parsed,
      relays: normalizeRelays(parsed.relays?.length ? parsed.relays : defaults.relays),
      contacts: Array.isArray(parsed.contacts) ? parsed.contacts : [],
    };
  } catch {
    return defaults;
  }
}

function writeConfig(config: NostrConfig) {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(configFile(), 0o600);
  } catch {
    // Termux filesystems may ignore chmod.
  }
}

function configFile() {
  const configured = (process.env.CLAWMOBILE_NOSTR_CONFIG || "").trim();
  return configured || path.join(os.homedir(), ".clawmobile", "nostr", "config.json");
}

function envRelays() {
  const raw = (process.env.CLAWMOBILE_NOSTR_RELAYS || "").trim();
  return raw ? raw.split(/[\s,]+/).filter(Boolean) : DEFAULT_RELAYS;
}

function relaysForRecipient(pubkey: string, explicit?: string[]) {
  const contact = contactForPubkey(pubkey);
  return normalizeRelays(explicit || contact?.relays || readConfig().relays);
}

function contactForPubkey(pubkey: string) {
  return readConfig().contacts.find((contact) => contact.pubkey === pubkey);
}

function redactContact(contact: NostrContact) {
  return {
    id: contact.id,
    pubkey: contact.pubkey,
    npub: contact.npub,
    label: contact.label,
    relays: contact.relays || [],
    trusted: contact.trusted !== false,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
  };
}

function parseEnvelope(text: string): NostrEnvelope {
  try {
    const parsed = JSON.parse(text);
    if (parsed?.type && parsed?.version) {
      return {
        type: parsed.type,
        version: Number(parsed.version) || 1,
        createdAt: Number(parsed.createdAt) || Date.now(),
        message: String(parsed.message || ""),
        payload: parsed.payload,
      };
    }
  } catch {
    // Plain Nostr direct message.
  }
  return {
    type: "clawmobile.agent_message",
    version: 1,
    createdAt: Date.now(),
    message: text,
  };
}

function extractSkillShare(envelope: NostrEnvelope): SkillSharePackage | undefined {
  if (envelope.type === "clawmobile.skill.share" && envelope.payload?.type === "clawmobile.skill.share") {
    return envelope.payload as SkillSharePackage;
  }
  if (envelope.payload?.type === "clawmobile.skill.share") {
    return envelope.payload as SkillSharePackage;
  }
  return undefined;
}

function parseSecretKey(value: string) {
  const text = value.trim();
  if (!text) throw new Error("Nostr secret key is empty.");
  if (text.startsWith("nsec1")) {
    const decoded = nip19.decode(text);
    if (decoded.type !== "nsec") throw new Error("Expected an nsec key.");
    return decoded.data;
  }
  const bytes = hexToBytes(text);
  if (!bytes) throw new Error("Secret key must be nsec or 64-character hex.");
  return bytes;
}

function parsePublicKey(value: string) {
  const text = value.trim();
  if (!text) throw new Error("Nostr public key is empty.");
  if (text.startsWith("npub1")) {
    const decoded = nip19.decode(text);
    if (decoded.type !== "npub") throw new Error("Expected an npub key.");
    return decoded.data;
  }
  if (/^[a-f0-9]{64}$/i.test(text)) return text.toLowerCase();
  throw new Error("Public key must be npub or 64-character hex.");
}

function safeParsePublicKey(value: string) {
  try {
    return parsePublicKey(value);
  } catch {
    return undefined;
  }
}

function publicKeyFromSecret(secretKeyHex?: string) {
  const secretKey = hexToBytes(secretKeyHex || "");
  return secretKey ? getPublicKey(secretKey) : undefined;
}

function normalizeRelays(relays: string[]) {
  const values = relays.length ? relays : DEFAULT_RELAYS;
  return Array.from(new Set(values
    .map((relay) => String(relay || "").trim())
    .filter(Boolean)
    .map((relay) => relay.includes("://") ? relay : `wss://${relay}`)
    .map((relay) => relay.replace(/\/+$/, ""))));
}

function trimMessage(message: string) {
  const text = String(message || "").trim();
  if (text.length > MAX_MESSAGE_CHARS) {
    return `${text.slice(0, MAX_MESSAGE_CHARS - 1).trimEnd()}...`;
  }
  return text || "ClawMobile message";
}

function bytesToHex(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("hex");
}

function hexToBytes(hex: string) {
  const text = String(hex || "").trim();
  if (!/^[a-f0-9]{64}$/i.test(text)) return null;
  return Uint8Array.from(Buffer.from(text, "hex"));
}
