import { config as load } from 'dotenv';
load({ path: '.env' });
process.env.NODE_ENV = 'test';
