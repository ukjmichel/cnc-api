// src/db/mongo.ts
import mongoose from 'mongoose';
import { config } from '../config/env.js';

/**
 * Builds MongoDB URI from config or uses provided URI.
 */
function buildMongoUri(): string {
  // Use explicit URI if provided
  if (config.mongoUri) {
    return config.mongoUri;
  }

  // Build URI from individual components
  const {
    mongoUsername,
    mongoPassword,
    mongoHost,
    mongoPort,
    mongoDatabase,
    mongoAuthSource,
  } = config;

  return `mongodb://${mongoUsername}:${mongoPassword}@${mongoHost}:${mongoPort}/${mongoDatabase}?authSource=${mongoAuthSource}`;
}

/**
 * Connects to MongoDB using Mongoose.
 * @returns {Promise<void>}
 */
export const connectMongoDB = async (): Promise<void> => {
  try {
    const uri = buildMongoUri();

    await mongoose.connect(uri);
    console.log('✅ Connected to MongoDB:', mongoose.connection.name);
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    throw error; // Let the caller handle the error
  }
};

/**
 * Pings MongoDB to check connection health.
 */
export const pingMongoDB = async (): Promise<void> => {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('MongoDB not connected');
  }

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB database instance not available');
  }

  await db.admin().ping();
};

/**
 * Closes MongoDB connection gracefully.
 */
export const closeMongoDB = async (): Promise<void> => {
  await mongoose.connection.close();
  console.log('👋 MongoDB connection closed');
};

export default connectMongoDB;
