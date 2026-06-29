// Jest global setup — set environment variables before any test runs
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET = 'test-jwt-secret-that-is-at-least-32-characters-long';
process.env.RABBITMQ_URL = 'amqp://guest:guest@localhost:5672';
process.env.FRONTEND_URL = 'http://localhost:3000';
