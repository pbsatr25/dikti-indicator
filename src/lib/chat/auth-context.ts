import { prisma } from "@/lib/prisma";
import type { AuthResult } from "@/lib/chat/types";

/**
 * Verifikasi user dari header `x-user-email`, kemudian validasi ke database.
 *
 * Mekanisme auth ini menggunakan header `x-user-email` yang diisi oleh frontend
 * dari data sesi yang disimpan di localStorage setelah login berhasil
 * (credential atau Google OAuth). Header ini dianggap tepercaya selama
 * permintaan hanya datang dari klien yang sudah login melalui /api/auth/login.
 *
 * TODO: Tingkatkan ke cookie/JWT session jika model auth berubah.
 * Signature `(request: Request) => Promise<AuthResult>` tidak perlu berubah.
 */
export async function getAuthenticatedUser(request: Request): Promise<AuthResult> {
  const email = request.headers.get("x-user-email")?.trim().toLowerCase();

  if (!email) {
    return { status: "unauthenticated" };
  }

  const user = await prisma.appUser.findUnique({
    where: { email },
    select: { email: true, isActive: true },
  });

  if (!user) {
    return { status: "unauthenticated" };
  }

  if (!user.isActive) {
    return { status: "inactive" };
  }

  return { status: "ok", user: { email: user.email } };
}