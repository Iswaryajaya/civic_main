import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { isDepartment, type Department } from "../lib/complaint-meta";

function assertDepartment(department: string): Department {
  if (!isDepartment(department)) {
    throw new Error("Unknown municipal department.");
  }
  return department;
}

/**
 * Upgrade the signed-in user to an authority (admin) after they present the
 * municipal activation code, recording which department they signed in for.
 * The code is configured through the environment variable
 * AUTHORITY_ACTIVATION_CODE and falls back to the demo value.
 */
export const activateAuthority = mutation({
  args: { code: v.string(), department: v.string() },
  handler: async (ctx, { code, department }) => {
    const dept = assertDepartment(department);
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Sign in with your official mobile number first.");
    }

    const expected = process.env.AUTHORITY_ACTIVATION_CODE ?? "MUNI-2026";
    if (code.trim().toUpperCase() !== expected.toUpperCase()) {
      throw new Error("Invalid authority activation code.");
    }

    await ctx.db.patch(userId, { role: "admin", department: dept });
    return { ok: true, department: dept };
  },
});

/**
 * Switch an already-signed-in authority to a different department's view
 * (used when picking a department on the chooser while still authenticated).
 */
export const setDepartment = mutation({
  args: { department: v.string() },
  handler: async (ctx, { department }) => {
    const dept = assertDepartment(department);
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Sign in with your official mobile number first.");
    }

    const user = await ctx.db.get(userId);
    if (user?.role !== "admin") {
      throw new Error("Authority access required.");
    }

    await ctx.db.patch(userId, { department: dept });
    return { ok: true, department: dept };
  },
});
