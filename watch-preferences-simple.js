#!/usr/bin/env node

import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'discord-bot';

class SimplePreferenceWatcher {
    constructor() {
        this.client = null;
        this.db = null;
    }

    async connect() {
        console.log('🔗 Connecting to MongoDB...');
        this.client = new MongoClient(MONGO_URI);
        await this.client.connect();
        this.db = this.client.db(DB_NAME);
        console.log('✅ Connected to MongoDB successfully!');
    }

    async startWatching() {
        console.log('👀 Starting to watch user preferences...');
        console.log('Press Ctrl+C to stop watching\n');

        const collection = this.db.collection('userPreferences');
        
        // Show initial count
        const count = await collection.countDocuments();
        console.log(`📊 Currently ${count} user preferences in database\n`);

        // Create change stream
        const changeStream = collection.watch([], {
            fullDocument: 'updateLookup'
        });

        // Handle changes
        changeStream.on('change', (change) => {
            const timestamp = new Date().toLocaleTimeString();
            
            switch (change.operationType) {
                case 'insert':
                    console.log(`[${timestamp}] ➕ NEW PREFERENCE CREATED`);
                    this.displayPreference(change.fullDocument);
                    break;
                    
                case 'update':
                    console.log(`[${timestamp}] 🔄 PREFERENCE UPDATED`);
                    this.displayPreference(change.fullDocument);
                    break;
                    
                case 'delete':
                    console.log(`[${timestamp}] 🗑️  PREFERENCE DELETED`);
                    console.log(`   Document ID: ${change.documentKey._id}`);
                    break;
            }
            
            console.log(''); // Empty line
        });

        // Handle errors
        changeStream.on('error', (error) => {
            console.error('❌ Change stream error:', error);
        });
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

    async stopWatching() {
        if (this.client) {
            await this.client.close();
            console.log('\n👋 Disconnected from MongoDB');
        }
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Stopping preference watcher...');
    await watcher.stopWatching();
    process.exit(0);
});

// Start the watcher
const watcher = new SimplePreferenceWatcher();
await watcher.connect();
await watcher.startWatching();
