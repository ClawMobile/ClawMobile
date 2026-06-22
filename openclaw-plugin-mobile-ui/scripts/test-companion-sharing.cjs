const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { generateSecretKey, getPublicKey, nip19 } = require("nostr-tools");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "clawmobile-companion-sharing-"));
process.env.OPENCLAW_WORKSPACE = path.join(root, "workspace");
process.env.CLAWMOBILE_NOSTR_CONFIG = path.join(root, "nostr.json");
process.env.CLAWMOBILE_SKILL_IMPORT_DIR = path.join(root, "imports");
process.env.CLAWMOBILE_AGENT_MESSAGES_FILE = path.join(root, "messages.json");

const nostr = require("../dist/companion/nostr.js");
const agentMessages = require("../dist/companion/agentMessages.js");
const sharing = require("../dist/companion/skillSharing.js");

const identity = nostr.setupNostrIdentity({ relays: ["wss://relay.example.com"] });
assert.strictEqual(identity.ok, true);
assert.ok(identity.npub.startsWith("npub1"));
assert.ok(identity.nsec.startsWith("nsec1"));

const peerSecret = generateSecretKey();
const peerPubkey = getPublicKey(peerSecret);
const peerNpub = nip19.npubEncode(peerPubkey);
const contact = nostr.upsertNostrContact({
  npub: peerNpub,
  label: "Peer Agent",
  relays: ["wss://relay.example.com"],
  trusted: true,
});
assert.strictEqual(contact.ok, true);
assert.strictEqual(contact.contact.npub, peerNpub);
assert.strictEqual(nostr.listNostrContacts().contacts.length, 1);

const incoming = agentMessages.storeIncomingAgentMessages([
  {
    eventId: "event-in-1",
    fromPubkey: peerPubkey,
    fromNpub: peerNpub,
    fromLabel: "Peer Agent",
    createdAt: 1000,
    text: "Could you share the Calendar skill?",
    ok: true,
  },
]);
assert.strictEqual(incoming.insertedCount, 1);

let conversations = agentMessages.listAgentConversations(nostr.listNostrContacts().contacts);
assert.strictEqual(conversations.length, 1);
assert.strictEqual(conversations[0].agentId, peerNpub);
assert.strictEqual(conversations[0].unreadCount, 1);

const outgoing = agentMessages.storeOutgoingAgentMessage({
  eventId: "event-out-1",
  recipientPubkey: peerPubkey,
  recipientNpub: peerNpub,
  label: "Peer Agent",
  text: "Sure, sending a draft.",
  createdAt: 2000,
  status: "sent",
});
assert.strictEqual(outgoing.direction, "outgoing");

let messages = agentMessages.listAgentConversationMessages(peerNpub);
assert.deepStrictEqual(messages.map((message) => message.id), ["event-in-1", "event-out-1"]);
assert.strictEqual(messages[0].read, false);

const marked = agentMessages.markAgentMessageRead("event-in-1", { conversation: true });
assert.strictEqual(marked.ok, true);
conversations = agentMessages.listAgentConversations(nostr.listNostrContacts().contacts);
assert.strictEqual(conversations[0].unreadCount, 0);

const skillDir = path.join(process.env.OPENCLAW_WORKSPACE, "skills", "calendar-provider-note");
fs.mkdirSync(skillDir, { recursive: true });
fs.writeFileSync(
  path.join(skillDir, "SKILL.md"),
  [
    "---",
    "name: Calendar Provider Note",
    "description: Create calendar reminders through native provider paths.",
    "---",
    "# Calendar Provider Note",
    "",
    "Use this skill for Calendar reminder tasks that should avoid UI fallback.",
    "",
    "## Knowledge",
    "",
    "- Prefer provider inserts and exact field verification.",
  ].join("\n"),
);

const share = sharing.createSkillSharePackage("calendar-provider-note", {
  senderPubkey: identity.publicKey,
});
assert.strictEqual(share.ok, true);
assert.strictEqual(share.package.type, "clawmobile.skill.share");
assert.strictEqual(share.package.policy.autoRunAllowed, false);
assert.strictEqual(share.package.policy.includesRawTrace, false);

const pending = sharing.storePendingSkillImport(share.package, {
  transport: "nostr",
  senderPubkey: peerPubkey,
  eventId: "event-skill-1",
});
assert.strictEqual(pending.status, "pending");
assert.strictEqual(sharing.listPendingSkillImports().length, 1);

const accepted = sharing.acceptSkillImport(pending.importId);
assert.strictEqual(accepted.ok, true);
assert.ok(accepted.skillId.startsWith("shared-calendar-provider-note"));
assert.ok(fs.existsSync(path.join(accepted.skillDir, "SKILL.md")));
assert.ok(fs.existsSync(path.join(accepted.skillDir, "shared_skill.json")));

const secondPending = sharing.storePendingSkillImport(share.package, {
  transport: "nostr",
  senderPubkey: peerPubkey,
  eventId: "event-skill-2",
});
const rejected = sharing.rejectSkillImport(secondPending.importId);
assert.strictEqual(rejected.ok, true);
assert.strictEqual(rejected.import.status, "rejected");

const cleared = agentMessages.clearAgentConversationMessages(peerNpub);
assert.strictEqual(cleared.ok, true);
assert.strictEqual(agentMessages.listAgentConversationMessages(peerNpub).length, 0);

const deleted = nostr.deleteNostrContact({ value: peerNpub });
assert.strictEqual(deleted.ok, true);
assert.strictEqual(nostr.listNostrContacts().contacts.length, 0);

console.log(`companion sharing test passed: ${root}`);
