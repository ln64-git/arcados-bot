#!/usr/bin/env node

import chalk from 'chalk';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'discord-bot';

class PreferenceWatcher {
    constructor() {
        this.client = null;
        this.db = null;
        this.isWatching = false;
    }

    async connect() {
        try {
            console.log(chalk.blue('🔗 Connecting to MongoDB...'));
            this.client = new MongoClient(MONGO_URI);
            await this.client.connect();
            this.db = this.client.db(DB_NAME);
            console.log(chalk.green('✅ Connected to MongoDB successfully!'));
        } catch (error) {
            console.error(chalk.red('❌ Failed to connect to MongoDB:'), error);
            process.exit(1);
        }
    }

    async startWatching() {
        if (this.isWatching) {
            console.log(chalk.yellow('⚠️  Already watching preferences!'));
            return;
        }

        try {
            console.log(chalk.blue('👀 Starting to watch user preferences...'));
            console.log(chalk.gray('Press Ctrl+C to stop watching\n'));

            const collection = this.db.collection('userPreferences');
            
            // Create change stream
            const changeStream = collection.watch([], {
                fullDocument: 'updateLookup'
            });

            this.isWatching = true;

            // Handle changes
            changeStream.on('change', (change) => {
                this.handleChange(change);
            });

            // Handle errors
            changeStream.on('error', (error) => {
                console.error(chalk.red('❌ Change stream error:'), error);
            });

            // Show initial count
            const count = await collection.countDocuments();
            console.log(chalk.cyan(`📊 Currently ${count} user preferences in database\n`));

        } catch (error) {
            console.error(chalk.red('❌ Failed to start watching:'), error);
        }
    }

    handleChange(change) {
        const timestamp = new Date().toLocaleTimeString();
        
        switch (change.operationType) {
            case 'insert':
                console.log(chalk.green(`[${timestamp}] ➕ NEW PREFERENCE CREATED`));
                this.displayPreference(change.fullDocument, 'Created');
                break;
                
            case 'update':
                console.log(chalk.yellow(`[${timestamp}] 🔄 PREFERENCE UPDATED`));
                this.displayPreference(change.fullDocument, 'Updated');
                break;
                
            case 'delete':
                console.log(chalk.red(`[${timestamp}] 🗑️  PREFERENCE DELETED`));
                console.log(chalk.gray(`   Document ID: ${change.documentKey._id}`));
                break;
                
            default:
                console.log(chalk.gray(`[${timestamp}] ${change.operationType.toUpperCase()}`));
        }
        
        console.log(''); // Empty line for readability
    }

    displayPreference(doc, action) {
        console.log(chalk.cyan(`   User ID: ${doc.userId}`));
        console.log(chalk.cyan(`   Guild ID: ${doc.guildId}`));
        
        if (doc.preferredChannelName) {
            console.log(chalk.magenta(`   Preferred Name: "${doc.preferredChannelName}"`));
        }
        
        if (doc.lastUpdated) {
            const updateTime = new Date(doc.lastUpdated).toLocaleString();
            console.log(chalk.gray(`   Last Updated: ${updateTime}`));
        }
        
        if (doc.channelLimit) {
            console.log(chalk.blue(`   Channel Limit: ${doc.channelLimit}`));
        }
        
        if (doc.isPrivate !== undefined) {
            console.log(chalk.blue(`   Private Channel: ${doc.isPrivate ? 'Yes' : 'No'}`));
        }
    }

    async stopWatching() {
        if (this.client) {
            await this.client.close();
            console.log(chalk.green('\n👋 Disconnected from MongoDB'));
        }
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log(chalk.yellow('\n🛑 Stopping preference watcher...'));
    await watcher.stopWatching();
    process.exit(0);
});

// Start the watcher
const watcher = new PreferenceWatcher();
await watcher.connect();
await watcher.startWatching();
