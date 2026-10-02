import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { statusValidator, type ComplaintStatus } from "./schema";
import { departmentForIssueType, isDepartment, type Department } from "../lib/complaint-meta";

/** Department that handles a complaint (stored, with fallback for legacy docs). */
function complaintDepartment(c: { department?: string; issueType: string }): Department {
  return isDepartment(c.department) ? c.department : departmentForIssueType(c.issueType);
}

/** Generate a unique tracking ID, e.g. CGA-2026-8F3K2Q. */
function makeTrackingId(): string {
  const year = new Date().getFullYear();
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `CGA-${year}-${suffix}`;
}

/**
 * Finalize a complaint draft: generate the unique Tracking ID, store the
 * AI report, and submit. Runs in two steps so the ID is generated before the
 * complaint is visible to anyone.
 */
export const createComplaint = mutation({
  args: {
    draft: v.object({
      title: v.string(),
      description: v.string(),
      issueType: v.string(),
      severity: v.union(
        v.literal("low"),
        v.literal("medium"),
        v.literal("high"),
        v.literal("critical"),
      ),
      language: v.string(),
      transcript: v.array(
        v.object({
          role: v.union(v.literal("user"), v.literal("assistant")),
          content: v.string(),
        }),
      ),
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
        address: v.optional(v.string()),
      }),
      aiReport: v.object({
        summary: v.string(),
        observations: v.string(),
        recommendedAction: v.string(),
        riskNote: v.string(),
      }),
    }),
  },
  handler: async (ctx, { draft }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Please sign in to submit a report.");

    const user = await ctx.db.get(userId);
    if (!user?.phone) throw new Error("Sign in with your mobile number first.");

    // Retry a few times in case of an ID collision.
    let trackingId = makeTrackingId();
    for (let i = 0; i < 5; i++) {
      const clash = await ctx.db
        .query("complaints")
        .withIndex("by_tracking_id", (q) => q.eq("trackingId", trackingId))
        .unique();
      if (!clash) break;
      trackingId = makeTrackingId();
    }

    const now = Date.now();
    const complaintId = await ctx.db.insert("complaints", {
      ...draft,
      department: departmentForIssueType(draft.issueType),
      trackingId,
      citizenId: userId,
      phone: user.phone,
      status: "new",
      statusHistory: [{ status: "new", at: now, actor: "system", note: "Complaint filed by citizen" }],
      aiReviewed: false,
      createdAt: now,
      updatedAt: now,
    });

    return { trackingId, complaintId };
  },
});

/** Complaints belonging to the signed-in citizen only. */
export const listMyComplaints = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("complaints")
      .withIndex("by_citizen", (q) => q.eq("citizenId", userId))
      .order("desc")
      .collect();
  },
});

/** Public tracking: only works when tracking ID AND phone match. */
export const trackComplaint = query({
  args: { trackingId: v.string(), phone: v.string() },
  handler: async (ctx, { trackingId, phone }) => {
    const normalized = phone.replace(/[\s\-()]/g, "");
    const complaint = await ctx.db
      .query("complaints")
      .withIndex("by_tracking_id", (q) => q.eq("trackingId", trackingId.trim().toUpperCase()))
      .unique();
    if (!complaint) return null;
    if (complaint.phone !== normalized) return null; // privacy: phone must match
    return complaint;
  },
});

/** Authority: list complaints visible to their department. */
export const listAllComplaints = query({
  args: { status: v.optional(statusValidator) },
  handler: async (ctx, { status }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const user = await ctx.db.get(userId);
    if (user?.role !== "admin") return []; // citizens see only their own

    // Department scoping: an authority signed in for a department only ever
    // sees that department's complaints. No department → full overview.
    const scope = isDepartment(user?.department) ? user.department : null;
    const inScope = (c: { department?: string; issueType: string }) =>
      scope === null || complaintDepartment(c) === scope;

    if (status) {
      const rows = await ctx.db
        .query("complaints")
        .withIndex("by_status", (q) => q.eq("status", status))
        .order("desc")
        .collect();
      return rows.filter(inScope);
    }
    return (await ctx.db.query("complaints").order("desc").collect()).filter(inScope);
  },
});

/** Authority: analytics for the dashboard. */
export const authorityAnalytics = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get(userId);
    if (user?.role !== "admin") return null;

    const scope = isDepartment(user?.department) ? user.department : null;
    const complaints = (await ctx.db.query("complaints").collect())
      .filter((c) => scope === null || complaintDepartment(c) === scope);
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const weekStart = now - 7 * dayMs;

    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byLocation: Record<string, number> = {};
    let last7Days = 0;
    const trendByDay: Record<string, number> = {};

    for (const c of complaints) {
      byType[c.issueType] = (byType[c.issueType] ?? 0) + 1;
      bySeverity[c.severity] = (bySeverity[c.severity] ?? 0) + 1;
      byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;

      const city = c.location.address?.split(",").slice(-3, -1).join(",").trim() || "Unspecified area";
      byLocation[city] = (byLocation[city] ?? 0) + 1;

      if (c.createdAt >= weekStart) {
        last7Days += 1;
        const day = new Date(c.createdAt).toISOString().slice(0, 10);
        trendByDay[day] = (trendByDay[day] ?? 0) + 1;
      }
    }

    // fill in the last 7 days even when zero
    const trend = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now - (6 - i) * dayMs).toISOString().slice(0, 10);
      return { day: d, count: trendByDay[d] ?? 0 };
    });

    const resolveTimes = complaints
      .filter((c) => c.resolvedAt && c.resolvedAt > c.createdAt)
      .map((c) => (c.resolvedAt! - c.createdAt) / dayMs);
    const avgResolutionDays = resolveTimes.length
      ? resolveTimes.reduce((a, b) => a + b, 0) / resolveTimes.length
      : 0;

    return {
      total: complaints.length,
      byType,
      bySeverity,
      byStatus,
      byLocation,
      last7Days,
      trend,
      avgResolutionDays,
    };
  },
});

/** Authority: review / approve the AI-generated report. */
export const reviewAiReport = mutation({
  args: {
    complaintId: v.id("complaints"),
    decision: v.union(v.literal("approve"), v.literal("reject")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { complaintId, decision, note }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");
    const user = await ctx.db.get(userId);
    if (user?.role !== "admin") throw new Error("Authority access required.");

    const complaint = await ctx.db.get(complaintId);
    if (!complaint) throw new Error("Complaint not found.");
    if (isDepartment(user?.department) && complaintDepartment(complaint) !== user.department) {
      throw new Error("This complaint belongs to another department.");
    }

    if (decision === "approve") {
      const now = Date.now();
      await ctx.db.patch(complaintId, {
        aiReviewed: true,
        reviewNote: note,
        status: "verified",
        updatedAt: now,
        statusHistory: [
          ...complaint.statusHistory,
          {
            status: "verified" as const,
            at: now,
            actor: "authority" as const,
            note: note ?? "AI report reviewed and approved by authority",
          },
        ],
      });
    } else {
      await ctx.db.patch(complaintId, {
        aiReviewed: false,
        reviewNote: note,
        updatedAt: Date.now(),
      });
    }
  },
});

/** Authority: move a complaint through the status workflow. */
export const updateStatus = mutation({
  args: {
    complaintId: v.id("complaints"),
    status: statusValidator,
    note: v.optional(v.string()),
  },
  handler: async (ctx, { complaintId, status, note }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");
    const user = await ctx.db.get(userId);
    if (user?.role !== "admin") throw new Error("Authority access required.");

    const complaint = await ctx.db.get(complaintId);
    if (!complaint) throw new Error("Complaint not found.");
    if (isDepartment(user?.department) && complaintDepartment(complaint) !== user.department) {
      throw new Error("This complaint belongs to another department.");
    }

    const now = Date.now();
    await ctx.db.patch(complaintId, {
      status,
      updatedAt: now,
      resolvedAt: status === "resolved" ? now : complaint.resolvedAt,
      statusHistory: [
        ...complaint.statusHistory,
        { status, at: now, actor: "authority" as const, note },
      ],
    });
  },
});

/** Internal: wipe all complaints (used by the demo reset button). */
export const resetDemoData = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("complaints").collect();
    for (const c of all) await ctx.db.delete(c._id);
    return { deleted: all.length };
  },
});

export const resetDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");
    const user = await ctx.db.get(userId);
    if (user?.role !== "admin") throw new Error("Authority access required.");
    const all = await ctx.db.query("complaints").collect();
    for (const c of all) await ctx.db.delete(c._id);
    return { ok: true, deleted: all.length };
  },
});

/**
 * Authority: seed a realistic demo dataset covering every department, so
 * each department's scoped queue, analytics and map have data to show.
 * Only seeds when the complaints table is empty.
 */
export const seedDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");
    const user = await ctx.db.get(userId);
    if (user?.role !== "admin") throw new Error("Authority access required.");

    const existing = await ctx.db.query("complaints").collect();
    if (existing.length > 0) {
      return { ok: false, created: 0, reason: "Complaints already exist. Reset first." };
    }

    // One shared demo citizen owns the seeded complaints.
    const DEMO_PHONE = "9000000001";
    let citizen = await ctx.db
      .query("users")
      .withIndex("phone", (q) => q.eq("phone", DEMO_PHONE))
      .unique();
    if (!citizen) {
      const cid = await ctx.db.insert("users", {
        phone: DEMO_PHONE,
        name: "Asha (Demo Citizen)",
        role: "user",
      });
      citizen = await ctx.db.get(cid);
    }
    if (!citizen) throw new Error("Could not create the demo citizen.");

    type Seed = {
      issueType: string;
      title: string;
      description: string;
      severity: "low" | "medium" | "high" | "critical";
      status: ComplaintStatus;
      ageDays: number;
      lat: number;
      lng: number;
      address: string;
      summary: string;
      observations: string;
      recommendedAction: string;
      riskNote: string;
      language?: string;
    };

    const seeds: Seed[] = [
      {
        issueType: "garbage",
        title: "Uncollected garbage beside the market road",
        description: "Mountains of mixed waste have been lying beside the market road for four days, spilling onto the footpath.",
        severity: "high",
        status: "in_progress",
        ageDays: 6,
        lat: 12.9724,
        lng: 77.5931,
        address: "Market Road, Shivajinagar, Bengaluru",
        summary: "Garbage pile uncollected for four days beside the market road.",
        observations: "Photo shows mixed municipal waste covering half the footpath with scattered plastic.",
        recommendedAction: "Deploy a sanitation crew and schedule daily collection at this spot.",
        riskNote: "Health hazard for vendors and pedestrians.",
        language: "hi",
      },
      {
        issueType: "streetlight",
        title: "Three streetlights dark on residential street",
        description: "Streetlights 4, 5 and 6 on the stretch have been dark for over a week, leaving the street unlit at night.",
        severity: "medium",
        status: "verified",
        ageDays: 3,
        lat: 12.9768,
        lng: 77.6012,
        address: "4th Cross, Indiranagar, Bengaluru",
        summary: "Three consecutive streetlights have been non-functional for a week.",
        observations: "Citizen photo shows dead poles at night with no light spill on the road.",
        recommendedAction: "Check the feeder circuit and replace the failed LED modules.",
        riskNote: "Reduced visibility raises accident and snatching risk.",
      },
      {
        issueType: "water_leak",
        title: "Pipe leak wasting water at junction",
        description: "A continuous leak at the junction is wasting treated water and waterlogging the corner.",
        severity: "high",
        status: "assigned",
        ageDays: 2,
        lat: 12.9698,
        lng: 77.5885,
        address: "Junction near City Market, Bengaluru",
        summary: "Continuous pipe leak at the junction wasting treated water.",
        observations: "Water pools at the corner throughout the day; pressure appears low downstream.",
        recommendedAction: "Isolate the section and replace the leaking joint.",
        riskNote: "Water loss and slippery road surface.",
      },
      {
        issueType: "pothole",
        title: "Deep pothole near bus stop",
        description: "A deep pothole has opened up right where buses pull in, forcing passengers into the carriageway.",
        severity: "critical",
        status: "new",
        ageDays: 1,
        lat: 12.9716,
        lng: 77.5946,
        address: "Bus stop near MG Road, Bengaluru",
        summary: "Deep pothole at the bus boarding point forcing passengers into traffic.",
        observations: "Image shows a pothole roughly 40 cm deep with loose aggregate around the edge.",
        recommendedAction: "Patch-fill today and schedule permanent resurfacing.",
        riskNote: "High chance of two-wheeler falls and pedestrian trips.",
        language: "te",
      },
      {
        issueType: "drainage",
        title: "Clogged storm drain causing street flooding",
        description: "The storm drain is blocked with silt and plastic; even light rain floods the street to ankle height.",
        severity: "high",
        status: "in_progress",
        ageDays: 5,
        lat: 12.9642,
        lng: 77.5961,
        address: "1st Main, Jayanagar, Bengaluru",
        summary: "Storm drain blocked with silt and plastic causing street flooding.",
        observations: "Drain mouth is fully covered by debris; standing water visible on the carriageway.",
        recommendedAction: "Desilt the drain and clear the mouth before the next spell of rain.",
        riskNote: "Standing water breeds mosquitoes and hides road damage.",
      },
      {
        issueType: "encroachment",
        title: "Footpath encroached by shop extension",
        description: "A permanent extension onto the footpath forces pedestrians, including schoolchildren, onto the road.",
        severity: "medium",
        status: "verified",
        ageDays: 8,
        lat: 12.9788,
        lng: 77.6065,
        address: "CMH Road, Indiranagar, Bengaluru",
        summary: "Permanent footpath encroachment pushing pedestrians onto the road.",
        observations: "Structure occupies nearly the full footpath width; no space to pass.",
        recommendedAction: "Issue a removal notice and restore the footpath clearance.",
        riskNote: "Pedestrians walk in traffic; accessibility blocked.",
      },
      {
        issueType: "road_damage",
        title: "Broken road edge after utility work",
        description: "The road edge was left broken after utility digging and has widened into a hazard for two-wheelers.",
        severity: "medium",
        status: "resolved",
        ageDays: 9,
        lat: 12.9589,
        lng: 77.5812,
        address: "Bannerghatta Road, Bengaluru",
        summary: "Broken road edge left after utility digging.",
        observations: "Trench backfill has settled, leaving a 15 cm drop at the lane edge.",
        recommendedAction: "Re-fill with granular material and re-lay the surface course.",
        riskNote: "Edge drops can throw two-wheelers off balance.",
      },
      {
        issueType: "traffic_signal",
        title: "Signal stuck on red at peak hours",
        description: "The signal at the intersection sticks on red for one arm, causing long queues every evening.",
        severity: "high",
        status: "resolved",
        ageDays: 12,
        lat: 12.9731,
        lng: 77.6068,
        address: "80 Feet Road junction, Bengaluru",
        summary: "Signal controller stuck on red for one arm during peak hours.",
        observations: "Queue extends past the junction; controller cabinet appears tampered with.",
        recommendedAction: "Repair or replace the controller and seal the cabinet.",
        riskNote: "Long queues and risky manual crossing.",
      },
    ];

    const FLOW: ComplaintStatus[] = ["new", "verified", "assigned", "in_progress", "resolved"];
    const DAY = 24 * 60 * 60 * 1000;
    let created = 0;

    for (const s of seeds) {
      // unique tracking id
      let trackingId = makeTrackingId();
      for (let i = 0; i < 5; i++) {
        const clash = await ctx.db
          .query("complaints")
          .withIndex("by_tracking_id", (q) => q.eq("trackingId", trackingId))
          .unique();
        if (!clash) break;
        trackingId = makeTrackingId();
      }

      const stage = FLOW.indexOf(s.status);
      const createdAt = Date.now() - s.ageDays * DAY;
      const step = (s.ageDays * DAY) / (FLOW.length + 1);
      const statusHistory = FLOW.slice(0, stage + 1).map((status, i) => ({
        status,
        at: Math.round(createdAt + step * (i + 1)),
        actor: i === 0 ? ("system" as const) : ("authority" as const),
        note: i === 0 ? "Complaint filed by citizen" : `Moved to ${status}`,
      }));

      await ctx.db.insert("complaints", {
        trackingId,
        citizenId: citizen._id,
        phone: citizen.phone ?? DEMO_PHONE,
        title: s.title,
        description: s.description,
        issueType: s.issueType,
        department: departmentForIssueType(s.issueType),
        severity: s.severity,
        status: s.status,
        language: s.language ?? "en",
        transcript: [],
        evidence: [],
        location: { lat: s.lat, lng: s.lng, address: s.address },
        aiReport: {
          summary: s.summary,
          observations: s.observations,
          recommendedAction: s.recommendedAction,
          riskNote: s.riskNote,
        },
        statusHistory,
        aiReviewed: stage >= 1,
        resolvedAt: s.status === "resolved" ? Math.round(createdAt + 1.5 * DAY) : undefined,
        createdAt,
        updatedAt: Date.now(),
      });
      created += 1;
    }

    return { ok: true, created };
  },
});
