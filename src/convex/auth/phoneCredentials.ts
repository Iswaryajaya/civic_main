import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/**
 * Phone + OTP credentials provider for Civic Guide AI.
 *
 * The OTP is issued in src/convex/phoneOtp.ts (public mutation
 * `requestPhoneOtp`) and verified inside `authorize`, so a session is only
 * created for a caller who can present a valid, unexpired code.
 */
export const PhoneCredentials = ConvexCredentials({
  id: "phone-otp",
  authorize: async (params, ctx): Promise<{ userId: Id<"users"> } | null> => {
    const rawPhone = typeof params.phone === "string" ? params.phone : "";
    const phone = rawPhone.replace(/[\s\-()]/g, "");
    const code = typeof params.code === "string" ? params.code : "";

    if (!/^\+?\d{10,15}$/.test(phone) || !/^\d{6}$/.test(code)) {
      return null;
    }

    const valid: boolean = await ctx.runMutation(internal.phoneOtp.verifyPhoneOtp, {
      phone,
      code,
    });
    if (!valid) return null;

    const existing = await ctx.runQuery(internal.users.getUserByPhone, { phone });
    if (existing) return { userId: existing._id };

    const role = params.role === "authority" ? "admin" : "user";
    const name =
      typeof params.name === "string" && params.name.trim().length > 0
        ? params.name.trim()
        : `Citizen ${phone.slice(-4)}`;

    const userId: Id<"users"> = await ctx.runMutation(internal.users.createUserWithPhone, {
      phone,
      name,
      role,
    });
    return { userId };
  },
});
