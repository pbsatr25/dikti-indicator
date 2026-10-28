import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaPool?: Pool;
};

let prismaClient: PrismaClient | undefined;

function getConnectionString() {
  const rawUrl = process.env.DATABASE_URL;

  if (!rawUrl) {
    throw new Error("DATABASE_URL belum dikonfigurasi.");
  }

  // Cegah warning pg-connection-string v3 & pastikan sslmode tidak meng-override rejectUnauthorized
  try {
    const parsed = new URL(rawUrl);
    if (parsed.searchParams.has("sslmode") && !parsed.searchParams.has("uselibpqcompat")) {
      parsed.searchParams.set("uselibpqcompat", "true");
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function getPool() {
  const existingPool = globalForPrisma.prismaPool;

  if (existingPool) {
    return existingPool;
  }

  const connectionString = getConnectionString();
  const isCloudSsl =
    connectionString.includes("neon.tech") ||
    connectionString.includes("pooler") ||
    connectionString.includes("supabase") ||
    connectionString.includes("sslmode=");

  const pool = new Pool({
    connectionString,
    ssl: isCloudSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 20000, // Tutup koneksi idle sebelum diputus sepihak oleh Neon/Cloud
    connectionTimeoutMillis: 15000, // Toleransi bila database Neon sedang bangun dari sleep (cold start)
    keepAlive: true, // Jaga soket TCP tetap hidup
  });

  // Tangkap error pada idle client agar tidak membuat crash / menggantung
  pool.on("error", (err) => {
    console.warn("[PRISMA-POOL] Idle client error (akan reconnect otomatis):", err.message);
  });

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prismaPool = pool;
  }

  return pool;
}

function getPrismaClient() {
  if (prismaClient) {
    return prismaClient;
  }

  prismaClient =
    globalForPrisma.prisma ??
    new PrismaClient({
      adapter: new PrismaPg(getPool()),
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    });

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prismaClient;
  }

  return prismaClient;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
}) as PrismaClient;