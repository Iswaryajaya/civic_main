import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

/** Complaint lifecycle status. */
export const COMPLAINT_STATUSES = [
  "new",
  "verified",
  "assigned",
  "in_progress",
  "resolved",
] as const;
export const statusValidator = v.union(
  ...COMPLAINT_STATUSES.map((s) => v.literal(s)),
);
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove

      // civic guide ai fields
      phone: v.optional(v.string()), // verified mobile number (citizen or authority)
      preferredLanguage: v.optional(v.string()),
      department: v.optional(v.string()), // authority only: municipal department
    }).index("email", ["email"]).index("phone", ["phone"]), // index for the email. do not remove or modify

    // one-time codes for phone sign-in (citizen + authority)
    phoneOtpCodes: defineTable({
      phone: v.string(),
      code: v.string(),
      expiresAt: v.number(),
      consumed: v.boolean(),
      createdAt: v.number(),
    })
      .index("by_phone", ["phone"])
      .index("by_phone_and_code", ["phone", "code"]),

    // civic complaints
    complaints: defineTable({
      trackingId: v.string(), // public unique ID, e.g. CGA-2026-8F3K2Q
      citizenId: v.id("users"),
      phone: v.string(), // denormalized for fast tracking lookups

      title: v.string(),
      description: v.string(), // AI-written structured summary
      issueType: v.string(), // e.g. pothole, garbage, streetlight...
      severity: v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("critical")),
      status: statusValidator,

      language: v.string(), // language the citizen conversed in
      transcript: v.array(
        v.object({
          role: v.union(v.literal("user"), v.literal("assistant")),
          content: v.string(),
        }),
      ),

      // evidence (base64 data URLs kept small for the prototype)
      evidence: v.array(
        v.object({
          kind: v.union(v.literal("photo"), v.literal("video"), v.literal("file")),
          mimeType: v.string(),
          dataUrl: v.string(),
          name: v.optional(v.string()),
          aiAnalysis: v.optional(v.string()),
        }),
      ),

      location: v.object({
        lat: v.number(),
        lng: v.number(),
        accuracy: v.optional(v.number()),
        address: v.optional(v.string()), // reverse-geocoded
      }),

      aiReport: v.optional(
        v.object({
          summary: v.string(),
          observations: v.string(),
          recommendedAction: v.string(),
          riskNote: v.optional(v.string()),
        }),
      ),

      statusHistory: v.array(
        v.object({
          status: statusValidator,
          at: v.number(),
          note: v.optional(v.string()),
          actor: v.union(v.literal("citizen"), v.literal("system"), v.literal("authority")),
        }),
      ),

      // authority workflow
      department: v.optional(v.string()), // routing: municipal department that handles this
      aiReviewed: v.optional(v.boolean()), // authority approved AI report
      reviewNote: v.optional(v.string()),
      assignedZone: v.optional(v.string()),
      resolvedAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_tracking_id", ["trackingId"])
      .index("by_citizen", ["citizenId"])
      .index("by_status", ["status"])
      .index("by_created", ["createdAt"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
