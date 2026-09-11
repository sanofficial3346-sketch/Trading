import { PrismaClient, Prisma } from '@prisma/client';

export type DatabaseHealthStatus = 'CONNECTED' | 'NOT_CONFIGURED' | 'ERROR';

export interface DatabaseHealth {
  status: DatabaseHealthStatus;
  provider: string;
  persistent: boolean;
  message?: string;
  tablesCount?: number;
}

// Global reference for server singleton to avoid connection exhaustion in dev/hot reload
const globalForPrisma = globalThis as unknown as {
  prismaInstance?: PrismaClient;
};

/**
 * Returns the server-side PrismaClient singleton.
 * Uses lazy initialization to prevent startup crashes when DATABASE_URL is not yet provided.
 */
export function getPrismaClient(): PrismaClient {
  if (!globalForPrisma.prismaInstance) {
    const dbUrl = process.env.DATABASE_URL?.trim();
    if (!dbUrl) {
      throw new Error('DATABASE_URL environment variable is not configured');
    }

    // Ensure DIRECT_URL is initialized if not explicitly set
    if (!process.env.DIRECT_URL || process.env.DIRECT_URL.trim().length === 0) {
      process.env.DIRECT_URL = dbUrl;
    }

    globalForPrisma.prismaInstance = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  return globalForPrisma.prismaInstance;
}

/**
 * Returns PrismaClient singleton safely, or null if DATABASE_URL is not configured.
 */
export function getPrismaClientSafe(): PrismaClient | null {
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl || dbUrl.length < 10) return null;
  try {
    return getPrismaClient();
  } catch {
    return null;
  }
}

/**
 * Cleanly disconnects the Prisma client if active.
 */
export async function disconnectPrisma(): Promise<void> {
  if (globalForPrisma.prismaInstance) {
    await globalForPrisma.prismaInstance.$disconnect();
    globalForPrisma.prismaInstance = undefined;
  }
}

/**
 * Server-side database health check.
 * Strictly NEVER exposes credentials, database passwords, or raw connection strings.
 */
export async function checkDatabaseHealth(): Promise<DatabaseHealth> {
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl || dbUrl.length < 10) {
    return {
      status: 'NOT_CONFIGURED',
      provider: 'Supabase PostgreSQL (Prisma)',
      persistent: false,
      message: 'DATABASE_URL is not configured in server environment.',
    };
  }

  try {
    const client = getPrismaClient();

    // Probe basic connectivity
    await client.$queryRaw`SELECT 1 as probe`;

    // Query active public tables to verify schema migration presence
    const tables = await client.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `;

    return {
      status: 'CONNECTED',
      provider: 'Supabase PostgreSQL (Prisma)',
      persistent: true,
      message: 'PostgreSQL database connection verified and operational.',
      tablesCount: Array.isArray(tables) ? tables.length : undefined,
    };
  } catch (err: unknown) {
    const rawError = (err as Error).message || '';
    // Redact any potential connection string or password traces from error message
    const sanitizedError = rawError.split('\n')[0].replace(/:\/\/[^@]+@/, '://***:***@');

    return {
      status: 'ERROR',
      provider: 'Supabase PostgreSQL (Prisma)',
      persistent: false,
      message: sanitizedError || 'Database connection error.',
    };
  }
}

export { Prisma };
