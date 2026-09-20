import { MongoClient } from 'mongodb';
import { config } from './config.js';

let client;
let db;

export async function getDb() {
  if (db) return db;
  client = new MongoClient(config.mongoUri);
  await client.connect();
  db = client.db();
  await Promise.all([
    db.collection('kb_chunks').createIndex({ jurisdiction: 1, origin: 1 }),
    db.collection('conversations').createIndex({ started_at: -1 }),
    db.collection('conversations').createIndex({ status: 1 }),
    db.collection('messages').createIndex({ conversation_id: 1, created_at: 1 }),
    db.collection('eval_runs').createIndex({ run_at: -1 }),
  ]);
  return db;
}

export async function closeDb() {
  if (client) await client.close();
  client = undefined;
  db = undefined;
}
