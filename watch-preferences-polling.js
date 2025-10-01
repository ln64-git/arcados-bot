#!/usr/bin/env node

import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'discord-bot';

class PollingPreferenceWatcher {
    constructor() {
        this.client = null;
        this.db = null;
        this.lastSeenIds = new Set();
        this.isWatching = false;
        this.pollInterval = 2000; // Poll every 2 seconds
    }

    async connect() {
        console.log('🔗 Connecting to MongoDB...');
        this.client = new MongoClient(MONGO_URI);
        await this.client.connect();
        this.db = this.client.db(DB_NAME);
        console.log('✅ Connected to MongoDB successfully!');
    }

    async startWatching() {
        if (this.isWatching) {
            console.log('⚠️  Already watching preferences!');
            return;
        }

        console.log('👀 Starting to watch user preferences (polling mode)...');
        console.log('Press Ctrl+C to stop watching\n');

        const collection = this.db.collection('userPreferences');
        
        // Show initial count and populate lastSeenIds
        const initialDocs = await collection.find({}).toArray();
        console.log(`📊 Currently ${initialDocs.length} user preferences in database`);
        
        // Add all existing document IDs to lastSeenIds
        initialDocs.forEach(doc => {
            this.lastSeenIds.add(doc._id.toString());
        });
        
        console.log('🔍 Monitoring for changes...\n');

        this.isWatching = true;
        this.startPolling();
    }

    async startPolling() {
        const collection = this.db.collection('userPreferences');
        
        const poll = async () => {
            if (!this.isWatching) return;

            try {
                // Get all documents
                const docs = await collection.find({}).toArray();
                const currentIds = new Set(docs.map(doc => doc._id.toString()));

                // Check for new documents
                for (const doc of docs) {
                    const docId = doc._id.toString();
                    if (!this.lastSeenIds.has(docId)) {
                        this.handleNewDocument(doc);
                        this.lastSeenIds.add(docId);
                    }
                }

                // Check for updated documents
                for (const doc of docs) {
                    const docId = doc._id.toString();
                    if (this.lastSeenIds.has(docId)) {
                        // Check if this document was recently updated
                        const now = new Date();
                        const docTime = new Date(doc.lastUpdated || doc._id.getTimestamp());
                        const timeDiff = now - docTime;
                        
                        // If updated within last 5 seconds, it's likely a new update
                        if (timeDiff < 5000 && doc.lastUpdated) {
                            this.handleUpdatedDocument(doc);
                        }
                    }
                }

                // Check for deleted documents
                for (const docId of this.lastSeenIds) {
                    if (!currentIds.has(docId)) {
                        this.handleDeletedDocument(docId);
                        this.lastSeenIds.delete(docId);
                    }
                }

            } catch (error) {
                console.error('❌ Polling error:', error);
            }

            // Schedule next poll
            setTimeout(poll, this.pollInterval);
        };

        // Start polling
        poll();
    }

    handleNewDocument(doc) {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] ➕ NEW PREFERENCE CREATED`);
        this.displayPreference(doc);
        console.log('');
    }

    handleUpdatedDocument(doc) {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] 🔄 PREFERENCE UPDATED`);
        this.displayPreference(doc);
        console.log('');
    }

    handleDeletedDocument(docId) {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] 🗑️  PREFERENCE DELETED`);
        console.log(`   Document ID: ${docId}`);
        console.log('');
    }

    displayPreference(doc) {
        console.log(`   User ID: ${doc.userId}`);
        console.log(`   Guild ID: ${doc.guildId}`);
        
        if (doc.preferredChannelName) {
            console.log(`   Preferred Name: "${doc.preferredChannelName}"`);
        }
        
        if (doc.lastUpdated) {
            const updateTime = new Date(doc.lastUpdated).toLocaleString();
            console.log(`   Last Updated: ${updateTime}`);
        }
        
        if (doc.channelLimit) {
            console.log(`   Channel Limit: ${doc.channelLimit}`);
        }
        
        if (doc.isPrivate !== undefined) {
            console.log(`   Private Channel: ${doc.isPrivate ? 'Yes' : 'No'}`);
        }
    }

    stopWatching() {
        this.isWatching = false;
        console.log('👋 Stopped watching preferences');
    }

    async disconnect() {
        if (this.client) {
            await this.client.close();
            console.log('\n👋 Disconnected from MongoDB');
        }
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Stopping preference watcher...');
    watcher.stopWatching();
    await watcher.disconnect();
    process.exit(0);
});

// Start the watcher
const watcher = new PollingPreferenceWatcher();
await watcher.connect();
await watcher.startWatching();
