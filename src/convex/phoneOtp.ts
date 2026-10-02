import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

const normalizePhone = (raw: string) => raw.replace(/[\s\-()]/g, "");

/**
 * Step 1 of phone sign-in: create an OTP for a mobile number.
 *
 * Dev-mode delivery: the code is returned to the client and displayed in the
 * UI (no SMS gateway is wired in this prototype). To add real SMS later,
 * send `code` through a provider here and stop returning it.
 */
export const requestPhoneOtp = mutation({
  args: { phone: v.string() },
  handler: async (ctx, { phone }) => {
    const normalized = normalizePhone(phone);
    if (!/^\+?\d{10,15}$/.test(normalized)) {
      throw new Error("Please enter a valid mobile number.");
    }

    // Invalidate any previous unused codes for this number.
    const old = await ctx.db
      .query("phoneOtpCodes")
      .withIndex("by_phone", (q) => q.eq("phone", normalized))
      .collect();
    for (const row of old) {
      if (!row.consumed) await ctx.db.patch(row._id, { consumed: true });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await ctx.db.insert("phoneOtpCodes", {
      phone: normalized,
      code,
      expiresAt: Date.now() + OTP_TTL_MS,
      consumed: false,
      createdAt: Date.now(),
    });

    return { ok: true, phone: normalized, devCode: code };
  },
});

/** Consume an OTP. Internal: called by the phone credentials provider. */
export const verifyPhoneOtp = internalMutation({
  args: { phone: v.string(), code: v.string() },
  handler: async (ctx, { phone, code }) => {
    const rows = await ctx.db
      .query("phoneOtpCodes")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .filter((q) => q.eq(q.field("consumed"), false))
      .order("desc")
      .take(5);

    const match = rows.find((r) => r.code === code && r.expiresAt > Date.now());
    if (!match) return false;
    await ctx.db.patch(match._id, { consumed: true });
    return true;
  },
});
