import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";

const HASH_TAG = "scrypt";

export type AuthUser = {
  name: string;
  email: string;
  avatarUrl: string;
  provider: "credentials" | "google";
};

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(password, salt, 64).toString("hex");
  return `${HASH_TAG}:${salt}:${digest}`;
}

function verifyPassword(password: string, storedHash: string) {
  const [tag, salt, digestHex] = storedHash.split(":");
  if (tag !== HASH_TAG || !salt || !digestHex) return false;

  const expected = Buffer.from(digestHex, "hex");
  const actual = scryptSync(password, salt, 64);

  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export async function createCredentialsUser(input: {
  name: string;
  email: string;
  password: string;
}) {
  const email = input.email.toLowerCase();

  try {
    await prisma.appUser.create({
      data: {
        name: input.name,
        email,
        passwordHash: hashPassword(input.password),
        provider: "credentials"
      }
    });
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "P2002") {
      throw new Error("EMAIL_EXISTS");
    }
    throw error;
  }
}

export async function authenticateCredentials(input: {
  email: string;
  password: string;
}): Promise<AuthUser | null> {
  const email = input.email.toLowerCase();
  const user = await prisma.appUser.findUnique({ where: { email } });

  if (!user || user.provider !== "credentials" || !user.passwordHash) return null;
  if (!verifyPassword(input.password, user.passwordHash)) return null;

  if (!user.isActive) {
    throw new Error("USER_DEACTIVATED");
  }

  return {
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl || "",
    provider: "credentials"
  };
}

export async function upsertGoogleUser(input: {
  name: string;
  email: string;
  avatarUrl: string;
}): Promise<AuthUser> {
  const email = input.email.toLowerCase();

  const existing = await prisma.appUser.findUnique({ where: { email } });
  if (existing && !existing.isActive) {
    throw new Error("USER_DEACTIVATED");
  }

  const user = await prisma.appUser.upsert({
    where: { email },
    create: {
      name: input.name,
      email,
      provider: "google",
      avatarUrl: input.avatarUrl
    },
    update: {
      name: input.name,
      provider: "google",
      avatarUrl: input.avatarUrl,
      updatedAt: new Date()
    }
  });

  return {
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl || "",
    provider: "google"
  };
}

function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function requestPasswordReset(emailInput: string): Promise<string | null> {
  const email = emailInput.toLowerCase();
  const user = await prisma.appUser.findUnique({ where: { email } });

  if (!user || user.provider !== "credentials") {
    return null;
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = hashResetToken(token);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  await prisma.appUser.update({
    where: { email },
    data: {
      resetTokenHash: tokenHash,
      resetTokenExpiresAt: expiresAt,
      updatedAt: new Date()
    }
  });

  return token;
}

export async function resetPasswordByToken(token: string, newPassword: string): Promise<boolean> {
  const tokenHash = hashResetToken(token);
  const now = new Date();

  const user = await prisma.appUser.findFirst({
    where: {
      provider: "credentials",
      resetTokenHash: tokenHash,
      resetTokenExpiresAt: {
        gt: now
      }
    }
  });

  if (!user) return false;

  await prisma.appUser.update({
    where: { id: user.id },
    data: {
      passwordHash: hashPassword(newPassword),
      resetTokenHash: null,
      resetTokenExpiresAt: null,
      updatedAt: new Date()
    }
  });

  return true;
}
