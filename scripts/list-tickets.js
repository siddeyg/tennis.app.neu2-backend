#!/usr/bin/env node
/**
 * List Open Support Tickets
 *
 * Connects to MongoDB and prints open support tickets with their message
 * threads to stdout. Useful for quickly inspecting tickets from the terminal.
 *
 * Usage:
 *   node scripts/list-tickets.js
 *   node scripts/list-tickets.js --all
 *   node scripts/list-tickets.js --unread
 *   node scripts/list-tickets.js --status=in-progress
 *   node scripts/list-tickets.js --status=in-progress --no-messages
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import mongoose from 'mongoose';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env.development') });

import SupportTicket from '../src/models/SupportTicket.js';

// ─── CLI Args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getFlag = (prefix) => {
  const arg = args.find(a => a.startsWith(prefix + '='));
  return arg ? arg.slice(prefix.length + 1) : null;
};

const showAll      = hasFlag('--all');
const unreadOnly   = hasFlag('--unread');
const noMessages   = hasFlag('--no-messages');
const statusFilter = getFlag('--status');

// ─── Formatting helpers ────────────────────────────────────────────────────────

const WIDE  = '━'.repeat(55);
const THIN  = '─'.repeat(55);

const STATUS_LABELS = {
  'open':             'OFFEN',
  'in-progress':      'IN BEARBEITUNG',
  'waiting-customer': 'WARTET AUF ANTWORT',
  'resolved':         'GELÖST',
  'closed':           'GESCHLOSSEN',
};

const PRIORITY_LABELS = {
  low:    'niedrig',
  medium: 'mittel',
  high:   'hoch',
  urgent: 'dringend',
};

function formatDate(d) {
  if (!d) return '–';
  const dt = new Date(d);
  return dt.toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function truncate(text, maxLen = 300) {
  if (!text) return '';
  const clean = text.replace(/\r?\n/g, ' ').trim();
  return clean.length > maxLen ? clean.slice(0, maxLen) + '…' : clean;
}

function printTicket(ticket) {
  const statusLabel   = STATUS_LABELS[ticket.status] || ticket.status.toUpperCase();
  const priorityLabel = PRIORITY_LABELS[ticket.priority] || ticket.priority;
  const unreadNote    = ticket.unreadByAdmin > 0 ? `, ungelesen: ${ticket.unreadByAdmin}` : '';

  console.log(WIDE);
  console.log(`#${ticket.ticketNumber} [${statusLabel}] ${ticket.subject}`);
  console.log(`  Priorität: ${priorityLabel}${unreadNote}  |  Kategorie: ${ticket.category}`);
  console.log(`  Student: ${ticket.createdBy?.name || '?'} <${ticket.createdBy?.email || '?'}>`);
  console.log(`  Erstellt: ${formatDate(ticket.createdAt)}  |  Aktualisiert: ${formatDate(ticket.updatedAt)}`);

  if (noMessages) return;

  const visibleMessages = (ticket.messages || []).filter(m => !m.isDeleted);

  if (visibleMessages.length === 0) {
    console.log(THIN);
    console.log('  (keine Nachrichten)');
    return;
  }

  console.log(THIN);
  for (const msg of visibleMessages) {
    const role = msg.senderType === 'admin' ? '[admin]  ' : '[student]';
    const when = formatDate(msg.createdAt);
    console.log(`${role} ${when} — ${msg.senderName}`);
    console.log(`  ${truncate(msg.content)}`);
    console.log();
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('ERROR: MONGO_URI not set. Check backend/.env.development');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);

  // Build status filter
  let statusQuery;
  if (statusFilter) {
    const valid = ['open', 'in-progress', 'waiting-customer', 'resolved', 'closed'];
    if (!valid.includes(statusFilter)) {
      console.error(`ERROR: Ungültiger Status "${statusFilter}". Gültig: ${valid.join(', ')}`);
      await mongoose.disconnect();
      process.exit(1);
    }
    statusQuery = statusFilter;
  } else if (showAll) {
    statusQuery = { $in: ['open', 'in-progress', 'waiting-customer', 'resolved', 'closed'] };
  } else {
    statusQuery = { $in: ['open', 'in-progress', 'waiting-customer'] };
  }

  const query = {
    isDeleted: { $ne: true },
    status: statusQuery,
  };

  if (unreadOnly) {
    query.unreadByAdmin = { $gt: 0 };
  }

  const tickets = await SupportTicket.find(query).sort({ updatedAt: -1 }).lean();

  if (tickets.length === 0) {
    console.log('Keine Tickets gefunden.');
    await mongoose.disconnect();
    return;
  }

  const filterDesc = statusFilter
    ? `Status: ${statusFilter}`
    : showAll
      ? 'alle Status'
      : 'offen / in Bearbeitung / wartet auf Antwort';

  console.log(`\n${tickets.length} Ticket(s) — ${filterDesc}${unreadOnly ? ', nur ungelesen' : ''}\n`);

  for (const ticket of tickets) {
    printTicket(ticket);
  }

  console.log(WIDE);
  console.log(`\nGesamt: ${tickets.length} Ticket(s)\n`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Fehler:', err.message);
  process.exit(1);
});
